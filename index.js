const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const { MongoClient } = require("mongodb");

const client = new MongoClient(
  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@crud-practice-cluster.l3ixzxm.mongodb.net/?appName=crud-practice-cluster&compressors=zlib`,
);

async function connectToMongoDB() {
  try {
    await client.connect();

    const database = client.db("solevo-web");
    const usersCollection = database.collection("users");
    const productsCollection = database.collection("products");

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
          isPopular: 1,
          stock: 1,
          category: 1,
          isNew: 1,
          name: 1,
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
