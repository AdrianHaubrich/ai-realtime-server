import { Router } from "express";
import sessionRoutes from "./sessionRoutes.js";
import extractionRoutes from "./extractionRoutes.js";

const router = Router();

router.use(sessionRoutes);
router.use(extractionRoutes);

export default router;
