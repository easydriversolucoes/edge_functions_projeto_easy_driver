import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Configurações do Supabase e Mercado Pago
const PROJETO_URL = Deno.env.get("PROJETO_URL") ?? "";
const PROJETO_KEY = Deno.env.get("PROJETO_KEY") ?? "";
const MERCADO_PAGO_ACCESS_TOKEN = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";

// Criação do cliente Supabase com configurações específicas
const supabase = createClient(PROJETO_URL, PROJETO_KEY, {
  auth: {
    autoRefreshToken: false, // Não renova o token automaticamente
    persistSession: false,   // Não persiste a sessão
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

    const MAX_RETRIES = 5; // Número máximo de tentativas
    const RETRY_DELAY = 2000; // Atraso entre tentativas (ms)

    let status;
    let responseData;
    let attempts = 0;

    // Loop para verificar o status da transação
    do {
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

      responseData = await mercadoPagoResponse.json();
      status = responseData.status;
      attempts++;

      if (status === "pending" || status === "authorized" || status === "in_process") {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      }
    } while (
      (status === "pending" || status === "authorized" || status === "in_process") &&
      attempts < MAX_RETRIES
    );

    if (!["approved", "rejected", "cancelled"].includes(status)) {
      throw new Error("Status inválido recebido após tentativas.");
    }

    // Extração de dados relevantes da resposta
    const { 
      external_reference, 
      payment_type_id, 
      status_detail, 
      payer, 
      transaction_amount, 
      transaction_details, 
      point_of_interaction, 
      date_created 
    } = responseData;

    // Inserindo os dados na tabela `pagamentos`
    const { error } = await supabase
    .from("pagamentos")
    .insert({
      id_pedido: external_reference ? parseInt(external_reference) : null,
      id_pagamento_mp: id,
      payment_type_id,
      status,
      status_detail,
      payer: payer || null,
      identification: payer?.identification || null,
      transaction_amount,
      transaction_details: transaction_details || null,
      point_of_interaction: point_of_interaction || null,
      date_created,
    });

    if (error) {
      throw new Error(`Erro ao salvar no banco de dados: ${error.message}`);
    }

    // Nova funcionalidade: Chamada para geração de PDF se status approved e status_detail accredited
    if (status === "approved" && status_detail === "accredited") {
      try {
        const pdfResponse = await fetch(
          "https://ttnvqdkxivyumcipbfls.supabase.co/functions/v1/solicita-geracao-pdf",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              id_pedido: external_reference ? parseInt(external_reference) : null,
            }),
          }
        );

        if (!pdfResponse.ok) {
          console.error("Erro ao solicitar geração do PDF:", await pdfResponse.text());
        }
      } catch (pdfError) {
        console.error("Erro ao chamar endpoint de geração de PDF:", pdfError);
        // Não lançamos o erro para não interromper o fluxo principal
      }
    }

    // Retorno de sucesso com informações adicionais
    return new Response(
      JSON.stringify({ message: "Dados salvos com sucesso.", attempts, status }),
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