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
          productId: paymentInfo._id,
          productName: paymentInfo.productName,
        },
        customer_email: paymentInfo.email,
        success_url: `${process.env.SIDE_DOMAIN.replace(/\/+$/, "")}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SIDE_DOMAIN.replace(/\/+$/, "")}/dashboard/payment-cancel`,
      });

      res.send({ url: session.url });
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
