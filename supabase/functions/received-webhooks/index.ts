import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROJETO_URL = Deno.env.get("PROJETO_URL") ?? "";
const PROJETO_KEY = Deno.env.get("PROJETO_KEY") ?? "";
const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET") ?? "";

if (!PROJETO_URL || !PROJETO_KEY || !MP_WEBHOOK_SECRET) {
  throw new Error("Variáveis de ambiente não configuradas corretamente.");
}

const supabase = createClient(PROJETO_URL, PROJETO_KEY);

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type, X-Signature",
      },
    });
  }

  // Adicionar headers CORS
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST",
    "Access-Control-Allow-Headers": "Content-Type, X-Signature",
  };

  try {
    const url = new URL(req.url);
    const paymentIdFromQuery = url.searchParams.get("data.id");

    let paymentId = paymentIdFromQuery;
    let webhook;

    // Tentar extrair o payload do corpo da requisição
    if (!paymentIdFromQuery) {
      const body = await req.text();
      webhook = JSON.parse(body);

      // Validar assinatura HMAC-SHA256
      const signature = req.headers.get("x-signature");
      if (!signature) {
        return new Response("Missing signature", { status: 400, headers: corsHeaders });
      }

      const encoder = new TextEncoder();
      const hmac = await crypto.subtle.sign(
        "HMAC",
        await crypto.subtle.importKey(
          "raw",
          encoder.encode(MP_WEBHOOK_SECRET),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        ),
        encoder.encode(body)
      );

      const expectedSignature = Array.from(new Uint8Array(hmac))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      if (expectedSignature !== signature) {
        return new Response("Invalid signature", { status: 400, headers: corsHeaders });
      }

      paymentId = webhook?.data?.id;
    }

    // Validar se um paymentId foi extraído
    if (!paymentId) {
      return new Response("Invalid webhook payload", { status: 400, headers: corsHeaders });
    }

    // Inserir os dados no Supabase
    const { error } = await supabase.from("webhooks_received").insert([{
      payment_id: paymentId,
      webhook: webhook ?? { data: { id: paymentId }, source: "query_params" },
    }]);

    if (error) {
      console.error("Erro ao inserir no Supabase:", error);
      return new Response("Failed to save webhook", {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Chamada POST para o endpoint fornecido
    const paymentResponse = await fetch("https://ttnvqdkxivyumcipbfls.supabase.co/functions/v1/get-payment-mp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: paymentId }),
    });

    if (!paymentResponse.ok) {
      return new Response("Failed to call external endpoint", {
        status: 500,
        headers: corsHeaders,
      });
    }

    return new Response("Webhook processed successfully", {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error("Erro ao processar o webhook:", error);
    return new Response("Internal server error", {
      status: 500,
      headers: corsHeaders,
    });
  }
});
