// Runtime-agnostic payment providers (Node + Deno). Uses fetch only.

export interface PaymentRequest {
  /** Stable per-execution key; passed to the provider as its idempotency key. */
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  description: string;
  metadata: Record<string, string>;
}

export type PaymentResult =
  | {
      ok: true;
      provider: "stripe" | "demo";
      providerReference: string;
      status: string;
      livemode: false;
      raw: Record<string, unknown>;
    }
  | {
      ok: false;
      provider: "stripe" | "demo";
      error: { code: string; message: string };
    };

export interface PaymentProvider {
  readonly name: "stripe" | "demo";
  readonly label: string;
  executePurchase(request: PaymentRequest): Promise<PaymentResult>;
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe" as const;
  readonly label = "Stripe (test mode)";

  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    // Test mode only. Live keys are refused outright.
    if (!/^(sk|rk)_test_/.test(secretKey)) {
      throw new Error("StripePaymentProvider refuses non-test keys (expected sk_test_ or rk_test_)");
    }
  }

  async executePurchase(request: PaymentRequest): Promise<PaymentResult> {
    const body = new URLSearchParams();
    body.set("amount", String(request.amountCents));
    body.set("currency", request.currency);
    body.set("description", request.description);
    // Stripe's built-in test PaymentMethod; no real card data is ever collected.
    body.set("payment_method", "pm_card_visa");
    body.set("confirm", "true");
    body.set("automatic_payment_methods[enabled]", "true");
    body.set("automatic_payment_methods[allow_redirects]", "never");
    for (const [key, value] of Object.entries(request.metadata)) {
      body.set(`metadata[${key}]`, value);
    }

    let response: Response;
    try {
      response = await this.fetchImpl("https://api.stripe.com/v1/payment_intents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": request.idempotencyKey,
        },
        body,
      });
    } catch (error) {
      return {
        ok: false,
        provider: "stripe",
        error: { code: "NETWORK_ERROR", message: error instanceof Error ? error.message : "network error" },
      };
    }

    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const err = (json.error ?? {}) as { code?: string; message?: string; type?: string };
      return {
        ok: false,
        provider: "stripe",
        error: { code: err.code ?? err.type ?? `HTTP_${response.status}`, message: err.message ?? "Stripe error" },
      };
    }
    if (json.livemode === true) {
      return { ok: false, provider: "stripe", error: { code: "LIVEMODE_REFUSED", message: "Live mode payment refused" } };
    }
    const status = String(json.status ?? "unknown");
    if (status !== "succeeded") {
      return {
        ok: false,
        provider: "stripe",
        error: { code: "PAYMENT_NOT_SUCCEEDED", message: `PaymentIntent status ${status}` },
      };
    }
    return {
      ok: true,
      provider: "stripe",
      providerReference: String(json.id),
      status,
      livemode: false,
      raw: {
        id: json.id,
        amount: json.amount,
        currency: json.currency,
        status,
        created: json.created,
        latest_charge: json.latest_charge,
        payment_method: json.payment_method,
      },
    };
  }
}

/** Clearly-labelled local provider used only when Stripe is not configured. Never claims to be Stripe. */
export class DemoPaymentProvider implements PaymentProvider {
  readonly name = "demo" as const;
  readonly label = "Demo payment provider (no real payment)";
  private readonly committed = new Map<string, string>();

  async executePurchase(request: PaymentRequest): Promise<PaymentResult> {
    const bytes = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request.idempotencyKey)),
    );
    const ref =
      this.committed.get(request.idempotencyKey) ??
      `demo_pi_${Array.from(bytes.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("")}`;
    this.committed.set(request.idempotencyKey, ref);
    return {
      ok: true,
      provider: "demo",
      providerReference: ref,
      status: "succeeded",
      livemode: false,
      raw: { id: ref, amount: request.amountCents, currency: request.currency, status: "succeeded", demo: true },
    };
  }
}

export function createPaymentProvider(config: {
  preferred: "stripe" | "demo";
  stripeSecretKey: string | null;
}): PaymentProvider {
  if (config.preferred === "stripe" && config.stripeSecretKey) {
    return new StripePaymentProvider(config.stripeSecretKey);
  }
  return new DemoPaymentProvider();
}
