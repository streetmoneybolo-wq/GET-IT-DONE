#!/usr/bin/env python3
"""moomoo SIMULATED trade bridge for the Academy auto-trader.

Run this next to moomoo OpenD (same machine), then put it behind an HTTPS tunnel/reverse proxy and set on the Academy service:
  SML_MOOMOO_TRADE_BRIDGE=https://<your-tunnel>   SML_MOOMOO_TRADE_SECRET=<long random string>

SAFETY: every call uses TrdEnv.SIMULATE. There is no code path to the REAL environment, and every answer says "env": "SIMULATE".
UNTESTED against a live OpenD from the Academy repo's CI: try it first with the Academy's mode set to "dry", then "sim".

  pip install moomoo-api
  SML_TRADE_SECRET=... python3 bridge.py            # listens on 127.0.0.1:8765, OpenD on 127.0.0.1:11111
"""
import hashlib, hmac, json, os, time
from http.server import BaseHTTPRequestHandler, HTTPServer
from moomoo import OpenSecTradeContext, TrdEnv, TrdSide, OrderType, TrdMarket, SecurityFirm, RET_OK

SECRET = os.environ.get("SML_TRADE_SECRET", "")
OPEND_HOST, OPEND_PORT = os.environ.get("OPEND_HOST", "127.0.0.1"), int(os.environ.get("OPEND_PORT", "11111"))
ACC_ID = int(os.environ.get("SML_SIM_ACC_ID", "0"))  # optional: pick a specific simulated account (e.g. the tournament one) from get_acc_list
ENV = TrdEnv.SIMULATE  # hard-coded on purpose

assert len(SECRET) >= 16, "set SML_TRADE_SECRET to a long random string"

def ctx():
    return OpenSecTradeContext(filter_trdmarket=TrdMarket.US, host=OPEND_HOST, port=OPEND_PORT, security_firm=SecurityFirm.FUTUINC)

def ok(ret, data):
    if ret != RET_OK:
        raise RuntimeError(str(data))
    return data

class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def _auth(self, payload):
        ts = self.headers.get("x-sml-ts", ""); sig = self.headers.get("x-sml-sig", "")
        if abs(time.time() - int(ts or 0)) > 60: return False
        want = hmac.new(SECRET.encode(), (ts + "." + self.path + "." + payload).encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(want, sig) and hmac.compare_digest(self.headers.get("x-sml-key", ""), SECRET)

    def _run(self, payload):
        c = ctx()
        try:
            kw = {"trd_env": ENV}
            if ACC_ID: kw["acc_id"] = ACC_ID
            if self.path == "/trade/account":
                d = ok(*c.accinfo_query(**kw)).iloc[0]
                return {"env": "SIMULATE", "cash": float(d["cash"]), "equity": float(d["total_assets"]), "dayPnl": float(d.get("unrealized_pl", 0) or 0)}
            if self.path == "/trade/positions":
                df = ok(*c.position_list_query(**kw))
                return {"env": "SIMULATE", "positions": [{"symbol": r["code"], "qty": float(r["qty"]), "cost": float(r["cost_price"]), "last": float(r["nominal_price"])} for _, r in df.iterrows()]}
            if self.path == "/trade/order":
                b = json.loads(payload or "{}")
                side = TrdSide.BUY if b["side"] == "buy" else TrdSide.SELL
                typ = OrderType.NORMAL if b.get("type") == "limit" else OrderType.MARKET
                df = ok(*c.place_order(price=float(b.get("price") or 0), qty=int(b["qty"]), code=b["symbol"], trd_side=side, order_type=typ, **kw))
                return {"env": "SIMULATE", "id": str(df.iloc[0]["order_id"]), "status": "submitted"}
            return None
        finally:
            c.close()

    def _handle(self, payload=""):
        if not self._auth(payload): return self._send(401, {"error": "unauthorized"})
        try:
            r = self._run(payload)
            self._send(200 if r is not None else 404, r if r is not None else {"error": "not_found"})
        except Exception as e:
            self._send(502, {"error": str(e)[:200]})

    def do_GET(self): self._handle()
    def do_POST(self): self._handle(self.rfile.read(int(self.headers.get("content-length", 0) or 0)).decode())
    def log_message(self, *a): pass

if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(os.environ.get("PORT", "8765"))), H).serve_forever()
