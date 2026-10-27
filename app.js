import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import directoryRoutes from "./routes/directoryRoutes.js";
import fileRoutes from "./routes/fileRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";
import activityRoutes from "./routes/activityRoutes.js";
import checkAuth from "./middlewares/authMiddleware.js";
import { connectDB } from "./config/db.js";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

// global limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes in milliseconds
  max: 1000, // Generous limit for modern SPA multi-tab/polling requests
  message: "Too many requests from this IP, please try again after 15 minutes",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

import { backfillActivityActorNames } from "./utils/logActivity.js";

const mySecretKey = process.env.COOKIE_SECRET;

await connectDB();
await backfillActivityActorNames();

const app = express();
app.set("trust proxy", 1); //  Trust the Nginx reverse proxy to give us the real user IP (needed for Rate Limiter)

app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  }),
);

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(cookieParser(mySecretKey));

app.use(globalLimiter);

app.use("/directory", checkAuth, directoryRoutes);
app.use("/file", checkAuth, fileRoutes);
app.use("/", userRoutes);
app.use("/auth", authRoutes);
app.use("/subscriptions", subscriptionRoutes);
app.use("/activity", checkAuth, activityRoutes);

// get request for root
app.get("/", (req, res) => {
  res.json({
    app: "MyDrive",
    message: "🚀 Welcome to MyDrive API — your personal cloud storage backend.",
    status: "online",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

app.use((err, req, res, next) => {
  console.log(err);
  // res.status(err.status || 500).json({ error: "Something went wrong!" });
  res.json(err);
});

app.listen(process.env.PORT || 4000, () => {
  console.log(`✅ Server Started on port ${process.env.PORT || 4000}`);
});
