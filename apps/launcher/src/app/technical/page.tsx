"use client";

import { formatEther } from "viem";
import { useReadContract } from "wagmi";
import { KEY_DERIVATION_MESSAGE, storefrontFactoryAbi } from "@freeshop/shared";
import { launcherChain } from "@/lib/chains";
import { publicEnv } from "@/lib/env";

/** Everything a technical reader needs to verify the system, in one place. */
export default function Technical() {
  const chain = launcherChain();
  const explorer = chain.blockExplorers?.default?.url;
  const { data: launchFee } = useReadContract({
    address: publicEnv.factoryAddress,
    abi: storefrontFactoryAbi,
    functionName: "launchFee",
    query: { enabled: !!publicEnv.factoryAddress },
  });

  const addr = (address?: string) =>
    address ? (
      explorer ? (
        <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" className="mono">
          {address}
        </a>
      ) : (
        <span className="mono">{address}</span>
      )
    ) : (
      "not configured on this launcher"
    );

  return (
    <section className="reveal">
      <h1 className="section-title" style={{ marginTop: 40 }}>
        <span className="index">TECHNICAL DETAILS</span> How freeshop works
      </h1>
      <p style={{ fontSize: 14.5, maxWidth: "60ch" }}>
        Everything below is verifiable: the contracts are on-chain, the storefront ships as
        readable source, and nothing here depends on trusting us.
      </p>

      <h2 className="section-title" style={{ marginTop: 36 }}>
        <span className="index">01</span> This deployment (the Launcher)
      </h2>
      <dl className="rows">
        <div>
          <dt>network</dt>
          <dd>
            {chain.name} (chain id {chain.id})
          </dd>
        </div>
        <div>
          <dt>factory contract</dt>
          <dd>{addr(publicEnv.factoryAddress || undefined)}</dd>
        </div>
        <div>
          <dt>launch fee</dt>
          <dd>
            {launchFee !== undefined ? `${formatEther(launchFee)} ETH` : "read from the factory at launch time"} —
            owner-adjustable
          </dd>
        </div>
        <div>
          <dt>USDC (allowlisted)</dt>
          <dd>{addr(publicEnv.usdcAddress)}</dd>
        </div>
      </dl>

      <h2 className="section-title" style={{ marginTop: 36 }}>
        <span className="index">02</span> Contracts
      </h2>
      <p style={{ fontSize: 14.5, maxWidth: "60ch" }}>
        Solidity 0.8.30, OpenZeppelin v5 (<span className="mono">Ownable</span>,{" "}
        <span className="mono">ReentrancyGuard</span>, <span className="mono">SafeERC20</span>,{" "}
        <span className="mono">Address</span>). Two contracts:
      </p>
      <dl className="rows">
        <div>
          <dt>StorefrontFactory</dt>
          <dd>
            Deployed once per network. deployStore() charges the launch fee
            (forwarded whole to the treasury, never held), validates the payment asset (native ETH or an
            allowlisted ERC-20), deploys your shop&apos;s escrow contract, and records it in the on-chain
            merchant → shops registry that powers your dashboard. The platform owner can adjust the fee,
            treasury, and token allowlist for <em>future</em> shops only — it has no power over existing
            shops or their funds.
          </dd>
        </div>
        <div>
          <dt>StoreEscrow</dt>
          <dd>
            One per shop, owned by you. Payout address, payment token, price, encryption key, and order-form
            hash are immutable constructor arguments. Orders move{" "}
            PAID → FULFILLED | CANCELLED (merchant-only), and any non-refunded
            order can be refunded by the merchant while escrow covers it. ETH refunds push to the buyer and
            fall back to a claimable credit if the push reverts; the withdrawable balance always excludes
            unclaimed refunds. withdraw() is callable by anyone but only ever
            pays the immutable payout address.
          </dd>
        </div>
      </dl>

      <h2 className="section-title" style={{ marginTop: 36 }}>
        <span className="index">03</span> Order-detail encryption
      </h2>
      <p style={{ fontSize: 14.5, maxWidth: "60ch" }}>
        Buyer details (email, shipping address, …) are encrypted <em>in the buyer&apos;s browser</em> with{" "}
        <strong>x25519-xsalsa20-poly1305</strong> (NaCl <span className="mono">box</span>, via tweetnacl) to the
        shop&apos;s public key, using a fresh ephemeral sender key per order. Wire format:
      </p>
      <pre className="mono" style={{ fontSize: 13, overflowX: "auto" }}>
        version(1 byte, 0x01) || ephemeralPubKey(32) || nonce(24) || ciphertext
      </pre>
      <p style={{ fontSize: 14.5, maxWidth: "60ch" }}>
        The ciphertext rides inside the payment transaction and is emitted as{" "}
        <span className="mono">OrderPlaced</span> event data — it never touches contract storage or any
        server. The merchant&apos;s keypair is derived from a wallet signature: the keccak256 of the
        signature over this exact message seeds the x25519 secret key, so the same wallet re-derives the
        same key on any device, and there is no key file to store or lose:
      </p>
      <pre className="mono" style={{ fontSize: 13, overflowX: "auto", whiteSpace: "pre-wrap" }}>
        {KEY_DERIVATION_MESSAGE}
      </pre>
      <div className="note note--warn">
        <span>⚠</span>
        <span>
          Consequences to understand: ciphertext on a public blockchain is permanent and cannot be deleted;
          whoever controls the merchant wallet can read order details; losing the wallet means losing the
          ability to read past orders — no one, including us, can recover them.
        </span>
      </div>

      <h2 className="section-title" style={{ marginTop: 36 }}>
        <span className="index">04</span> Order-form commitment
      </h2>
      <p style={{ fontSize: 14.5, maxWidth: "60ch" }}>
        The checkout form&apos;s fields are hashed (<span className="mono">keccak256</span> of their canonical
        JSON) and committed on-chain at deploy as <span className="mono">fulfillmentSchemaHash</span>. Every
        storefront re-hashes the form it is about to show and compares against the chain — a mismatch warns
        buyers and disables checkout, so a tampered site can&apos;t quietly ask for extra data.
      </p>

      <h2 className="section-title" style={{ marginTop: 36 }}>
        <span className="index">05</span> Sign-in &amp; data
      </h2>
      <p style={{ fontSize: 14.5, maxWidth: "60ch" }}>
        The launcher uses Sign-In with Ethereum (EIP-4361): a nonce, a{" "}
        <span className="mono">personal_sign</span> signature, an encrypted session cookie. No passwords. The
        only personal data the platform stores is the optional account email; shops, funds, and order data
        live on-chain and in your keys. The storefront and its <span className="mono">admin.html</span>{" "}
        dashboard are fully static — they talk to the blockchain directly over RPC and have no backend at
        all.
      </p>
      <p style={{ fontSize: 14.5, maxWidth: "60ch" }}>
        Only injected wallets are supported to avoid dependency on WalletConnect.
      </p>

      {publicEnv.templateRepoUrl && (
        <>
          <h2 className="section-title" style={{ marginTop: 36 }}>
            <span className="index">06</span> Source
          </h2>
          <p style={{ fontSize: 14.5, maxWidth: "60ch" }}>
            The storefront template (contracts interface, encryption code, everything above in code form) is
            public:{" "}
            <a href={publicEnv.templateRepoUrl} target="_blank" rel="noreferrer">
              {publicEnv.templateRepoUrl}
            </a>
          </p>
        </>
      )}
    </section>
  );
}
