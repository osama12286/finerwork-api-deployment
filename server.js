// server.js
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();
const app = express();
app.use(express.json({ type: "application/json" }));

/**
 * -------------------------------
 * CONFIG
 * -------------------------------
 */
// Shopify config
const SHOPIFY_STORE = process.env.SHOPIFY_STORE; // e.g. emeryart.myshopify.com
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;
const SHOPIFY_API_VERSION = "2025-01";
const SHOPIFY_LOCATION_ID = process.env.SHOPIFY_LOCATION_ID;
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

// FinerWorks config
const FINERWORKS_API_BASE = process.env.FINERWORKS_API_BASE; // https://api.finerworks.com/v3
const FINERWORKS_KEY = process.env.FINERWORKS_KEY;
const FINERWORKS_WEB_KEY = process.env.FINERWORKS_WEB_KEY;

/**
 * -------------------------------
 * VERIFY SHOPIFY WEBHOOK
 * -------------------------------
 */
function verifyShopifyWebhook(req) {
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  const body = JSON.stringify(req.body);
  const hash = crypto
    .createHmac("sha256", SHOPIFY_WEBHOOK_SECRET)
    .update(body, "utf8")
    .digest("base64");
  return hash === hmacHeader;
}

/**
 * -------------------------------
 * HELPER → Get product details from FinerWorks
 * -------------------------------
 */
async function getFinerWorksProductDetails(skus) {
  const response = await axios.post(
    `${FINERWORKS_API_BASE}/get_product_details`,
    skus.map((sku) => ({
      product_order_po: null,
      product_qty: 1,
      product_sku: sku,
    })),
    {
      headers: {
        "Content-Type": "application/json",
        "web_api_key": FINERWORKS_WEB_KEY,
        "app_key": FINERWORKS_KEY,
      },
    }
  );
  return response.data;
}

/**
 * -------------------------------
 * PRODUCT SYNC (FinerWorks → Shopify)
 * -------------------------------
 */
app.get("/sync-products", async (req, res) => {
  try {
    // 1. Get products from FinerWorks
    const fwRes = await axios.get(`${FINERWORKS_API_BASE}/products`, {
      headers: { Authorization: `Bearer ${FINERWORKS_KEY}` },
    });
    const fwProducts = fwRes.data;

    // 2. Loop through products and push to Shopify
    for (const fwProduct of fwProducts) {
      const shopifyProduct = {
        product: {
          title: fwProduct.name,
          body_html: fwProduct.description,
          vendor: "FinerWorks",
          variants: fwProduct.variants.map((v) => ({
            sku: v.sku,
            price: v.price,
            option1: v.option1,
            option2: v.option2,
            option3: v.option3,
          })),
        },
      };

      const shopifyRes = await axios.post(
        `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/products.json`,
        shopifyProduct,
        {
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          },
        }
      );

      console.log(`✅ Synced product ${fwProduct.name}`, shopifyRes.data);
    }

    res.json({ message: "✅ Products synced from FinerWorks → Shopify" });
  } catch (err) {
    console.error("❌ Error syncing products:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * -------------------------------
 * ORDER SYNC (Shopify → FinerWorks)
 * -------------------------------
 */
app.post("/shopify-order-created", async (req, res) => {
  if (!verifyShopifyWebhook(req)) {
    console.error("❌ Invalid Shopify HMAC");
    return res.sendStatus(401);
  }

  const order = req.body;
  console.log("📦 New order from Shopify:", order.id);

  try {
    // 🔹 Fetch product details from FinerWorks for order SKUs
    const skus = order.line_items.map((item) => item.sku);
    const productDetails = await getFinerWorksProductDetails(skus);
    console.log("ℹ️ Product details from FinerWorks:", productDetails);

    // 🔹 Send order to FinerWorks
    const fwResponse = await axios.post(
      `${FINERWORKS_API_BASE}/orders`,
      {
        orderNumber: order.id,
        shippingAddress: order.shipping_address,
        items: order.line_items.map((item) => ({
          sku: item.sku,
          quantity: item.quantity,
        })),
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${FINERWORKS_KEY}`,
        },
      }
    );

    console.log("✅ Sent to FinerWorks:", fwResponse.data);

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error sending to FinerWorks:", err.message);
    res.sendStatus(500);
  }
});

/**
 * -------------------------------
 * TRACKING SYNC (FinerWorks → Shopify)
 * -------------------------------
 */
app.post("/finerworks-update", async (req, res) => {
  const update = req.body;
  console.log("🔄 Update from FinerWorks:", update);

  const shopifyOrderId = update.orderNumber;
  const trackingNumber = update.trackingNumber;
  const carrier = update.carrier || "Other";

  try {
    const shopifyResponse = await axios.post(
      `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}/fulfillments.json`,
      {
        fulfillment: {
          location_id: SHOPIFY_LOCATION_ID,
          tracking_number: trackingNumber,
          tracking_company: carrier,
          notify_customer: true,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        },
      }
    );

    console.log("✅ Updated Shopify order:", shopifyResponse.data);

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error updating Shopify:", err.message);
    res.sendStatus(500);
  }
});

/**
 * -------------------------------
 * TEST FINERWORKS ENDPOINT
 * -------------------------------
 */
app.get("/test-finerworks", async (req, res) => {
  try {
    const result = await getFinerWorksProductDetails(["AP98520P583742"]);
    res.json(result);
  } catch (err) {
    console.error("❌ Test error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * -------------------------------
 * ROOT
 * -------------------------------
 */
app.get("/", (req, res) => {
  res.send("✅ Shopify ↔ FinerWorks middleware is running securely (Axios version).");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Middleware server running on port ${PORT}`)
);
