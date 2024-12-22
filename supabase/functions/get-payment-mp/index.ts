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
    console.log('ID recebido:', id); // Log para debug

    if (!id) {
      throw new Error("O campo 'id' é obrigatório.");
    }

    // Faz a requisição ao Mercado Pago com timeout reduzido
    const mercadoPagoResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${id}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`,
        },
        // Adicionando timeout na requisição
        signal: AbortSignal.timeout(3000), // 3 segundos de timeout
      }
    );

    if (!mercadoPagoResponse.ok) {
      throw new Error(
        `Erro ao consultar o Mercado Pago: ${mercadoPagoResponse.statusText}`
      );
    }

    const responseData = await mercadoPagoResponse.json();
    console.log('Dados recebidos do MP:', responseData.status); // Log para debug

    const { 
      external_reference, 
      payment_type_id, 
      status,
      status_detail, 
      payer, 
      transaction_amount, 
      transaction_details, 
      point_of_interaction, 
      date_created 
    } = responseData;

    console.log('Preparando inserção no banco...'); // Log para debug

    // Tentativa de inserção com timeout
    const insertPromise = supabase
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

    // Usando Promise.race para implementar um timeout manual
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout na inserção do banco')), 4000);
    });

    const { error } = await Promise.race([insertPromise, timeoutPromise]) as any;

    if (error) {
      console.error('Erro na inserção:', error); // Log para debug
      throw new Error(`Erro ao salvar no banco de dados: ${error.message}`);
    }

    console.log('Inserção concluída com sucesso'); // Log para debug

    return new Response(
      JSON.stringify({ 
        message: "Dados salvos com sucesso.", 
        status: responseData.status 
      }),
      { status: 200 }
    );

  } catch (error) {
    console.error("Erro detalhado na Edge Function:", error); // Log mais detalhado
    return new Response(
      JSON.stringify({
        error: "Erro interno do servidor",
        details: error.message,
      }),
      { status: 500 }
    );
  }
});