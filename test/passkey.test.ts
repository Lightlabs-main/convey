import assert from "node:assert/strict";
import test from "node:test";
import { enrollReceiverPasskey, extractPrfOutput, unlockReceiverPasskey } from "../src/receiver/passkey.ts";

test("passkey ceremony requests PRF enrollment and evaluates the stored salt", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalCredential = Object.getOwnPropertyDescriptor(globalThis, "PublicKeyCredential");
  let createOptions: any;
  let getOptions: any;
  const expectedPrf = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

  class FakePublicKeyCredential {
    readonly rawId: ArrayBuffer;
    private readonly extensions: any;

    constructor(rawId: number[], extensions: any) {
      this.rawId = Uint8Array.from(rawId).buffer;
      this.extensions = extensions;
    }

    getClientExtensionResults(): any {
      return this.extensions;
    }
  }

  const fakeCredentials = {
    create: async (options: unknown) => {
      createOptions = options;
      return new FakePublicKeyCredential([1, 2, 3, 4], { prf: { enabled: true } });
    },
    get: async (options: unknown) => {
      getOptions = options;
      return new FakePublicKeyCredential([1, 2, 3, 4], { prf: { results: { first: expectedPrf.buffer } } });
    },
  };

  try {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { credentials: fakeCredentials } });
    Object.defineProperty(globalThis, "PublicKeyCredential", { configurable: true, value: FakePublicKeyCredential });

    const enrollment = await enrollReceiverPasskey({
      userId: new Uint8Array(16).fill(7),
      userName: "receiver@example.test",
      displayName: "Convey Receiver",
      rpName: "Convey Test",
      rpId: "example.test",
    });
    assert.equal(enrollment.credentialId, "AQIDBA");
    assert.equal(enrollment.prfSalt.length, 66);
    assert.deepEqual(enrollment.prfOutput, expectedPrf);
    assert.deepEqual(createOptions.publicKey.user.id, new Uint8Array(16).fill(7));
    assert.deepEqual(createOptions.publicKey.extensions, { prf: {} });
    assert.equal(createOptions.publicKey.authenticatorSelection.residentKey, "required");
    assert.equal(createOptions.publicKey.authenticatorSelection.userVerification, "required");

    const unlocked = await unlockReceiverPasskey(enrollment.credentialId, enrollment.prfSalt, "example.test");
    assert.deepEqual(unlocked, expectedPrf);
    assert.deepEqual(getOptions.publicKey.allowCredentials[0].id, new Uint8Array([1, 2, 3, 4]));
    assert.deepEqual(getOptions.publicKey.extensions.prf.eval.first, new Uint8Array(enrollment.prfSalt.slice(2).match(/../g)!.map((byte: string) => Number.parseInt(byte, 16))));
    assert.equal(getOptions.publicKey.rpId, "example.test");
    assert.equal(getOptions.publicKey.userVerification, "required");
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete (globalThis as any).navigator;
    if (originalCredential) Object.defineProperty(globalThis, "PublicKeyCredential", originalCredential);
    else delete (globalThis as any).PublicKeyCredential;
  }
});

test("passkey PRF extraction rejects missing or short output", () => {
  assert.throws(
    () => extractPrfOutput({ prf: { results: { first: new ArrayBuffer(31) } } } as AuthenticationExtensionsClientOutputs),
    /PRF result/,
  );
  assert.throws(
    () => extractPrfOutput({ prf: { results: { first: new Uint8Array(32) as unknown as ArrayBuffer } } } as AuthenticationExtensionsClientOutputs),
    /PRF result/,
  );
});
