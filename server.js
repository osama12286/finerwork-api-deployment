// server.js
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

// Shopify
const SHOPIFY_STORE = process.env.SHOPIFY_STORE; 
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN; 
const SHOPIFY_API_VERSION = "2025-01";
const SHOPIFY_LOCATION_ID = process.env.SHOPIFY_LOCATION_ID; 


const FINERWORKS_API_BASE = process.env.FINERWORKS_API_BASE; 
const FINERWORKS_KEY = process.env.FINERWORKS_KEY; 

app.post("/shopify-order-created", async (req, res) => {
  const order = req.body;

  console.log("📦 New order from Shopify:", order.id);

  try {
    const fwResponse = await fetch(`${FINERWORKS_API_BASE}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${FINERWORKS_KEY}`
      },
      body: JSON.stringify({
        orderNumber: order.id,
        shippingAddress: order.shipping_address,
        items: order.line_items.map(item => ({
          sku: item.sku,
          quantity: item.quantity
        }))
      })
    });

    const fwData = await fwResponse.json();
    console.log("✅ Sent to FinerWorks:", fwData);

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error sending to FinerWorks:", err);
    res.sendStatus(500);
  }
});

app.post("/finerworks-update", async (req, res) => {
  const update = req.body;
  console.log("🔄 Update from FinerWorks:", update);

  const shopifyOrderId = update.orderNumber; 
  const trackingNumber = update.trackingNumber;
  const carrier = update.carrier || "Other";

  try {
    
    const shopifyResponse = await fetch(`https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/orders/${shopifyOrderId}/fulfillments.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_TOKEN
      },
      body: JSON.stringify({
        fulfillment: {
          location_id: SHOPIFY_LOCATION_ID,
          tracking_number: trackingNumber,
          tracking_company: carrier,
          notify_customer: true
        }
      })
    });

    const shopifyData = await shopifyResponse.json();
    console.log("✅ Updated Shopify order:", shopifyData);

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error updating Shopify:", err);
    res.sendStatus(500);
  }
});


app.get("/", (req, res) => {
  res.send("✅ Shopify ↔ FinerWorks middleware is running.");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));