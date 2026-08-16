import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
	getTrustFile,
	isGuardArmed,
	isNetworkEnabled,
	getUrlhausKey,
	NETWORK_CACHE_TTL_MS,
	NETWORK_TIMEOUT_MS,
} from "./config.ts";

test("defaults match the approved plan", () => {
	assert.equal(
		getTrustFile(),
		path.join(os.homedir(), ".pi", "agent", "nma-trust.json"),
	);
	assert.equal(isNetworkEnabled(), true);
	assert.equal(NETWORK_CACHE_TTL_MS, 3600000);
	assert.equal(NETWORK_TIMEOUT_MS, 3000);
	assert.equal(getUrlhausKey(), "");
});

test("env overrides are honored at call time (NMA_TRUST_FILE, NMA_NETWORK, NMA_URLHAUS_KEY)", () => {
	const old = {
		trust: process.env.NMA_TRUST_FILE,
		net: process.env.NMA_NETWORK,
		key: process.env.NMA_URLHAUS_KEY,
	};
	process.env.NMA_TRUST_FILE = "/tmp/custom-trust.json";
	process.env.NMA_NETWORK = "0";
	process.env.NMA_URLHAUS_KEY = "test-key";
	try {
		assert.equal(getTrustFile(), "/tmp/custom-trust.json");
		assert.equal(isNetworkEnabled(), false);
		assert.equal(getUrlhausKey(), "test-key");
	} finally {
		if (old.trust === undefined) delete process.env.NMA_TRUST_FILE;
		else process.env.NMA_TRUST_FILE = old.trust;
		if (old.net === undefined) delete process.env.NMA_NETWORK;
		else process.env.NMA_NETWORK = old.net;
		if (old.key === undefined) delete process.env.NMA_URLHAUS_KEY;
		else process.env.NMA_URLHAUS_KEY = old.key;
	}
});

test("isGuardArmed: false when nothing loaded or all files trusted", () => {
	assert.equal(isGuardArmed([]), false);
	assert.equal(isGuardArmed([{ loaded: true, trusted: true }]), false);
	assert.equal(isGuardArmed([{ loaded: false, trusted: false }]), false);
});

test("isGuardArmed: true when any loaded file is not hash-trusted", () => {
	assert.equal(isGuardArmed([{ loaded: true, trusted: false }]), true);
	assert.equal(
		isGuardArmed([
			{ loaded: true, trusted: true },
			{ loaded: true, trusted: false },
		]),
		true,
	);
});
