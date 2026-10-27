const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const port = 3000;

const stripe = require("stripe")(process.env.STRIPE_SECRETE);

app.use(cors());
app.use(express.json());

const { MongoClient, ObjectId } = require("mongodb");

const client = new MongoClient(
  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@crud-practice-cluster.l3ixzxm.mongodb.net/?appName=crud-practice-cluster&compressors=zlib`,
);

async function connectToMongoDB() {
  try {
    await client.connect();

    const database = client.db("solevo-web");
    const usersCollection = database.collection("users");
    const productsCollection = database.collection("products");
    const cardCollection = database.collection("card");
    const arrivalsCollection = database.collection("arrivals");
    const paymentCollection = database.collection("payments");

    app.post("/users", async (req, res) => {
      const user = req.body;
      const email = user.email;

      const existEmail = await usersCollection.findOne({ email: email });
      if (existEmail) {
        return res.send({ message: "this user already has login" });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // products related apis

    app.post("/products", async (req, res) => {
      const products = req.body;
      const result = await productsCollection.insertOne(products);
      res.send(result);
    });

    app.get("/products", async (req, res) => {
      const { type, limit, sort } = req.query;

      let query = {};
      const limits = Number(limit);

      if (type === "popular") {
        query = { isPopular: true };
      }

      if (type === "new") {
        query = { isNew: true };
      }
      const cursor = productsCollection
        .find(query)
        .sort(sort)
        .project({
          image: 1,
          brand: 1,
          category: 1,
          isPopular: 1,
          stock: 1,
          category: 1,
          isNew: 1,
          name: 1,
          description: 1,
          colors: 1,
          rating: 1,
          reviews: 1,
          price: 1,
          oldPrice: 1,
          discount: 1,
        })
        .limit(limits);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/allProducts", async (req, res) => {
      const {
        search,
        category,
        brand,
        gender,
        limit = 0,
        skip = 0,
      } = req.query;
      const query = {};
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: "i" } },
          { brand: { $regex: search, $options: "i" } },
          { category: { $regex: search, $options: "i" } },
        ];
      }
      if (category) {
        query.category = category;
      }
      if (brand) {
        query.brand = brand;
      }
      if (gender) {
        query.gender = gender;
      }
      const totalProducts = await productsCollection.countDocuments(query);
      const products = await productsCollection
        .find(query)
        .limit(Number(limit))
        .skip(Number(skip))
        .toArray();

      res.send({ products, totalProducts });
    });

    app.get("/allProducts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productsCollection.findOne(query);
      res.send(result);
    });

    app.get("/filter-options", async (req, res) => {
      const { type, category, brand, gender } = req.query;

      const query = {};

      if (type !== "category" && category) {
        query.category = category;
      }

      if (type !== "brand" && brand) {
        query.brand = brand;
      }

      if (type !== "gender" && gender) {
        query.gender = gender;
      }

      let options = [];

      if (type === "category") {
        options = await productsCollection.distinct("category", query);
      }

      if (type === "brand") {
        options = await productsCollection.distinct("brand", query);
      }

      if (type === "gender") {
        options = await productsCollection.distinct("gender", query);
      }

      res.send(options);
    });

    // Payments related APIs

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      console.log(paymentInfo);

      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.productName,
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          productId: paymentInfo.productId,
          productName: paymentInfo.productName,
        },
        customer_email: paymentInfo.email,
        success_url: `${process.env.SIDE_DOMAIN.replace(/\/+$/, "")}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SIDE_DOMAIN.replace(/\/+$/, "")}/dashboard/payment-cancel`,
      });

      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;

      if (!sessionId) {
        return res.status(400).send({
          success: false,
          message: "Session ID is required",
        });
      }

      let dbSession;

      try {
        // 1. Verify payment directly with Stripe
        const stripeSession =
          await stripe.checkout.sessions.retrieve(sessionId);

        if (
          stripeSession.status !== "complete" ||
          stripeSession.payment_status !== "paid"
        ) {
          return res.status(400).send({
            success: false,
            message: "Payment is not completed",
          });
        }

        const productId = stripeSession.metadata?.productId;
        const productName = stripeSession.metadata?.productName;
        const email =
          stripeSession.customer_details?.email || stripeSession.customer_email;

        // console.log("Product ID:", productId);
        // console.log("Product Name:", productName);
        // console.log("Customer Email:", email);
        // console.log("Metadata:", stripeSession.metadata);

        if (!productId || !email || !ObjectId.isValid(productId)) {
          return res.status(400).send({
            success: false,
            message: "Invalid payment information",
          });
        }

        // 2. Check duplicate payment
        const paymentExist = await paymentCollection.findOne({
          sessionId: stripeSession.id,
        });

        if (paymentExist) {
          return res.send({
            success: true,
            message: "Payment already processed",
            transactionId: paymentExist.transactionId,
          });
        }

        // 3. Save payment, reduce stock and remove cart item
        dbSession = client.startSession();

        await dbSession.withTransaction(async () => {
          // Check again inside the transaction
          const duplicate = await paymentCollection.findOne(
            { sessionId: stripeSession.id },
            { session: dbSession },
          );

          if (duplicate) return;

          // Reduce stock only if stock is greater than zero
          const stockResult = await productsCollection.updateOne(
            {
              _id: new ObjectId(productId),
              stock: { $gt: 0 },
            },
            {
              $inc: { stock: -1 },
            },
            { session: dbSession },
          );

          if (stockResult.modifiedCount !== 1) {
            throw new Error("Product is out of stock");
          }

          // Remove only the purchased product from this user's cart
          await cardCollection.deleteOne(
            {
              email,
              id: productId,
            },
            { session: dbSession },
          );

          // Save payment history
          await paymentCollection.insertOne(
            {
              email,
              productId,
              productName,
              amount: stripeSession.amount_total / 100,
              currency: stripeSession.currency,
              transactionId: stripeSession.payment_intent,
              sessionId: stripeSession.id,
              paymentStatus: "paid",
              paidAt: new Date(),
            },
            { session: dbSession },
          );
        });

        return res.send({
          success: true,
          message: "Payment processed successfully",
          transactionId: stripeSession.payment_intent,
        });
      } catch (error) {
        console.error("Payment processing error:", error);

        return res.status(500).send({
          success: false,
          message: "Payment processing failed",
        });
      } finally {
        if (dbSession) {
          await dbSession.endSession();
        }
      }
    });

    app.get("/payments-history", async (req, res) => {
      const cursor = paymentCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // card related apis

    app.post("/cards", async (req, res) => {
      const card = req.body;
      const existingId = await cardCollection.findOne({
        email: card.email,
        id: card.id,
      });
      if (existingId) {
        return res.send({
          message: "this product already exist",
          exists: true,
        });
      }
      const result = await cardCollection.insertOne(card);
      res.send({ ...result, exists: false });
    });

    app.get("/cards", async (req, res) => {
      const email = req.query.email;
      const cursor = cardCollection.find({ email: email });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.delete("/cards/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cardCollection.deleteOne(query);
      res.send(result);
    });

    // arrivals related apis
    app.post("/arrivals", async (req, res) => {
      const data = req.body;
      const result = await arrivalsCollection.insertOne(data);
      res.send(result);
    });

    app.get("/arrivals", async (req, res) => {
      const cursor = arrivalsCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}
connectToMongoDB();
// // Call this only when your application terminates
// export async function disconnectFromMongoDB() {
//   await client.close();
// }

app.get("/", (req, res) => {
  res.send("solevo in running");
});

app.listen(port, () => {
  console.log(
    `solevo-web listening on port ${port} ${new Date().toLocaleTimeString()}`,
  );
});
