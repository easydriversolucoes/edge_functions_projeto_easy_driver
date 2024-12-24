import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Configurações do Supabase e Mercado Pago
const PROJETO_URL = Deno.env.get("PROJETO_URL") ?? "";
const PROJETO_KEY = Deno.env.get("PROJETO_KEY") ?? "";
const MERCADO_PAGO_ACCESS_TOKEN = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";

// Criação do cliente Supabase
const supabase = createClient(PROJETO_URL, PROJETO_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Função principal da Edge Function
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
    });
  }

  try {
    const { id }: { id: number } = await req.json();

    if (!id) {
      throw new Error("O campo 'id' é obrigatório.");
    }

    // Requisição ao Mercado Pago
    const mercadoPagoResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${id}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`,
        },
      }
    );

    if (!mercadoPagoResponse.ok) {
      throw new Error(
        `Erro ao consultar o Mercado Pago: ${mercadoPagoResponse.statusText}`
      );
    }

    const responseData = await mercadoPagoResponse.json();

    // Extração dos dados
    const {
      external_reference,
      payment_type_id,
      status,
      status_detail,
      payer,
      transaction_amount,
      transaction_details,
      point_of_interaction,
      date_created,
    } = responseData;

    // Inserir na tabela correta com base no status
    if (["pending", "authorized", "in_process"].includes(status)) {
      const { error } = await supabase.from("pendentes_mp").insert({
        id_pedido: external_reference ? parseInt(external_reference) : null,
        id_pagamento_mp: id,
        payment_type_id,
        status,
        status_detail,
        payer,
        identification: payer?.identification || null,
        transaction_amount,
        transaction_details,
        point_of_interaction,
        date_created,
      });

      if (error) {
        throw new Error(`Erro ao salvar na tabela pendentes_mp: ${error.message}`);
      }
    } else if (["approved", "rejected", "cancelled"].includes(status)) {
      const { error } = await supabase.from("pagamentos").insert({
        id_pedido: external_reference ? parseInt(external_reference) : null,
        id_pagamento_mp: id,
        payment_type_id,
        status,
        status_detail,
        payer,
        identification: payer?.identification || null,
        transaction_amount,
        transaction_details,
        point_of_interaction,
        date_created,
      });

      if (error) {
        throw new Error(`Erro ao salvar na tabela pagamentos: ${error.message}`);
      }
    } else {
      throw new Error("Status inválido ou não suportado.");
    }

    return new Response(
      JSON.stringify({ message: "Dados processados com sucesso." }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Erro na Edge Function:", error);
    return new Response(
      JSON.stringify({
        error: "Erro interno do servidor",
        details: error.message,
      }),
      { status: 500 }
    );
  }
});
