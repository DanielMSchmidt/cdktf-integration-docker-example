import express from "express";
import cors from "cors";

const app = express();
const port = parseInt(process.env.PORT || "4000");

app.use(cors());
app.use(express.json());

app.get("/posts", (_req, res) => {
  res.status(200).json({
    data: [
      { id: "1", content: "TODO: get a DB connection" },
      { id: "2", content: "TODO: implement post" },
    ],
  });
});

app.get("/posts/:id/detail", (_req, res) => {
  res.json({
    id: "3",
    content: "TODO: fetch real data",
    author: "Daniel",
    postedAt: new Date().toDateString(),
  });
});

app.post("/posts", (req, res)=>{
  console.log(req.body);
  res.sendStatus(201);
})

app.listen(port, () => {
  console.log(`Started at http://localhost:${port}`);
});
