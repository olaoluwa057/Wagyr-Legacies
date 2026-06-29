import "dotenv/config";

import { basename } from "node:path";
import { readFile, stat } from "node:fs/promises";

import {
  hasHelp,
  optionalArg,
  parseArgs,
  requireArg,
  requireEnv,
  stringifyJson,
} from "./lib/cli.js";

const PINATA_ENDPOINT = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const DEFAULT_GATEWAY = "https://gateway.pinata.cloud/ipfs";

type PinataPinFileResponse = {
  IpfsHash: string;
  PinSize?: number;
  Timestamp?: string;
  isDuplicate?: boolean;
};

const args = parseArgs();

if (hasHelp(args)) {
  printHelp();
  process.exit(0);
}

try {
  const filePath = requireArg(args, "file");
  const pinName = optionalArg(args, "name") ?? basename(filePath);

  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }

  const jwt = requireEnv("PINATA_JWT");
  const fileBytes = await readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(fileBytes)]), basename(filePath));
  form.append("pinataMetadata", JSON.stringify({ name: pinName }));

  const response = await fetch(PINATA_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Pinata upload failed (${response.status} ${response.statusText}): ${body}`);
  }

  const pinataResponse = (await response.json()) as PinataPinFileResponse;
  const cid = pinataResponse.IpfsHash;
  if (typeof cid !== "string" || cid.length === 0) {
    throw new Error("Pinata response did not include IpfsHash");
  }

  const gatewayBase = (process.env.PINATA_GATEWAY ?? DEFAULT_GATEWAY).replace(/\/$/, "");
  const result = {
    filename: basename(filePath),
    name: pinName,
    cid,
    ipfsUri: `ipfs://${cid}`,
    gatewayUrl: `${gatewayBase}/${cid}`,
    pinSize: pinataResponse.PinSize,
    timestamp: pinataResponse.Timestamp,
    isDuplicate: pinataResponse.isDuplicate,
  };

  console.log(stringifyJson(result));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("Run with --help for usage.");
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  npm run pin:ipfs -- --file <path> [--name <pin name>]

Environment:
  PINATA_JWT       Pinata API JWT with pinning permissions
  PINATA_GATEWAY   Optional gateway base, defaults to ${DEFAULT_GATEWAY}

Example:
  npm run pin:ipfs -- --file scripts/metadata.example.json --name wagyr-metadata-example`);
}
