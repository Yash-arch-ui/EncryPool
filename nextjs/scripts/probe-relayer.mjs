import { SepoliaConfig } from "@zama-fhe/sdk";
import { RelayerNode } from "@zama-fhe/sdk/node";

async function main() {
  const relayer = new RelayerNode({
    transports: { [SepoliaConfig.chainId]: SepoliaConfig },
    getChainId: async () => 11155111,
    poolSize: 1,
    logger: {
      info: (...a) => console.log("[info]", ...a),
      warn: (...a) => console.log("[warn]", ...a),
      error: (...a) => console.log("[error]", ...a),
      debug: (...a) => console.log("[debug]", ...a),
    },
  });
  try {
    const enc = await relayer.encrypt({
      values: [{ value: 1n, type: "euint64" }],
      contractAddress: "0xDD490eD46A6fe28e807500Bf7482b24d9077a812",
      userAddress: "0x3884d7c9bA39C00CE28b5F8bD26102Cd057fB9E4",
    });
    console.log("ENCRYPT OK", enc.handles[0]?.slice(0, 20));
  } catch (e) {
    console.error("ENC FAIL:", e.message);
    let c = e.cause;
    let depth = 0;
    while (c && depth++ < 5) {
      console.error("cause:", c.message ?? String(c));
      if (c.stack) console.error(c.stack.split("\n").slice(0, 4).join("\n"));
      c = c.cause;
    }
  } finally {
    relayer.terminate();
  }
}

main().then(
  () => process.exit(0),
  e => {
    console.error(e);
    process.exit(1);
  },
);
