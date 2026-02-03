import express from "express";
import { ethers } from "ethers";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ===== ENV =====
const RPC = process.env.RPC;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

// ===== PROVIDER =====
const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// BaseSwap (UniV2 style)
const ROUTER = "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86";
const WETH = "0x4200000000000000000000000000000000000006";

const ABI = [
  "function swapExactETHForTokens(uint,address[],address,uint) payable",
  "function swapExactTokensForETH(uint,uint,address[],address,uint)",
  "function getAmountsOut(uint,address[]) view returns (uint[])",
  "function approve(address,uint)"
];

const router = new ethers.Contract(ROUTER, ABI, wallet);

// ===== TELEGRAM =====
async function notify(msg) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TG_CHAT_ID,
      text: msg
    })
  });
}

// ===== AUTO TRADE =====
app.post("/auto", async (req, res) => {
  try {
    const { ca, buyUsd = 1, tp = 25, sl = -20 } = req.body;

    await notify(`🚀 AUTO BUY\n${ca}\n💵 ~$${buyUsd}`);

    // ~1 USD
    const buyEth = ethers.parseEther("0.0003");

    // BUY
    const buyTx = await router.swapExactETHForTokens(
      0,
      [WETH, ca],
      wallet.address,
      Math.floor(Date.now() / 1000) + 60,
      { value: buyEth, gasLimit: 300000 }
    );
    await buyTx.wait();

    const entry = (await router.getAmountsOut(buyEth, [WETH, ca]))[1];

    const TP = entry * BigInt(100 + tp) / 100n;
    const SL = entry * BigInt(100 + sl) / 100n;

    const start = Date.now();

    // WATCH PRICE
    while (Date.now() - start < 10 * 60 * 1000) {
      await new Promise(r => setTimeout(r, 8000));

      const cur = (await router.getAmountsOut(buyEth, [WETH, ca]))[1];

      if (cur >= TP || cur <= SL) {
        await notify(
          cur >= TP
            ? `📈 TP HIT ${tp}%\n${ca}`
            : `📉 SL HIT ${sl}%\n${ca}`
        );

        // SELL ALL
        await router.swapExactTokensForETH(
          entry,
          0,
          [ca, WETH],
          wallet.address,
          Math.floor(Date.now() / 1000) + 60,
          { gasLimit: 300000 }
        );
        break;
      }
    }

    res.json({ ok: true });
  } catch (e) {
    await notify(`❌ ERROR\n${e.message}`);
    res.json({ ok: false, error: e.message });
  }
});

app.listen(process.env.PORT || 3000);
