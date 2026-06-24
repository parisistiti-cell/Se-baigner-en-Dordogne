import express from "express";
import cors from "cors";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

const GH_OWNER = parisistiti-cell;
const GH_REPO = Se-baigner-en-Dordogne;
const GH_TOKEN = token GitHub avec écriture;
const ADMIN_SECRET = secret_long_et_aleatoire;

app.post("/api/add-lieu", async (req, res) => {
  try {
    const secret = req.headers["x-admin-secret"];
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const { title, lat, lng, desc, img } = req.body || {};
    if (!title || lat === undefined || lng === undefined) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    const payload = {
      id: `admin-${Date.now()}`,
      title,
      lat: Number(lat),
      lng: Number(lng),
      desc: desc || "",
      img: img || null
    };

    const ghResp = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${GH_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        event_type: "add-lieu",
        client_payload: payload
      })
    });

    if (!ghResp.ok) {
      const text = await ghResp.text();
      return res.status(500).json({ ok: false, error: text });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(process.env.PORT || 3000);