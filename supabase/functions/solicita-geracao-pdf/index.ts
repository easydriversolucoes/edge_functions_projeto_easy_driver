import { serve } from "https://deno.land/std@0.180.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";

const supabaseUrl = Deno.env.get("PROJETO_URL")!;
const supabaseKey = Deno.env.get("PROJETO_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

const PDF_MONKEY_API_KEY = "3fu4hckGSC9Qzevkk3fa";
const PDF_MONKEY_ENDPOINT = "https://api.pdfmonkey.io/api/v1/documents";
const DOCUMENT_TEMPLATE_ID = "EDD907F2-5DAC-4974-9443-BE4BFB79D478";

// Novo endpoint para a função get-pdf
const GET_PDF_ENDPOINT = "https://ttnvqdkxivyumcipbfls.supabase.co/functions/v1/get-pdf";

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const { id_pedido } = await req.json();
    if (!id_pedido) {
      return new Response("id_pedido is required", { status: 400 });
    }

    // Consultar as tabelas no Supabase
    const { data: respostaInstancia, error: errorInstancia } = await supabase
      .from("resposta_instancia")
      .select("*")
      .eq("id_pedido", id_pedido)
      .single();

    const { data: respostasArgumentos, error: errorArgumentos } = await supabase
      .from("respostas_argumentos")
      .select("*")
      .eq("id_pedido", id_pedido);

    const { data: respostasQualificacao, error: errorQualificacao } = await supabase
      .from("respostas_qualificacao")
      .select("*")
      .eq("id_pedido", id_pedido)
      .single();

    // Consultar informações da infração
    const { data: pedidoData, error: pedidoError } = await supabase
      .from('pedidos')
      .select('enquadramento')
      .eq('id_pedido', id_pedido)
      .single();

    const { data: infracaoData, error: infracaoError } = await supabase
      .from('infracoes')
      .select('artigo, descricao')
      .eq('enquadramento', pedidoData?.enquadramento)
      .single();

    if (errorInstancia || errorArgumentos || errorQualificacao || pedidoError || infracaoError) {
      console.error("Erro ao buscar dados:", {
        errorInstancia,
        errorArgumentos,
        errorQualificacao,
        pedidoError,
        infracaoError
      });
      return new Response("Erro ao buscar dados no Supabase", { status: 500 });
    }

    // Preparar o payload para o PDF Monkey
    const payload = {
      resposta_instancia: respostaInstancia,
      respostas_argumentos: respostasArgumentos,
      respostas_qualificacao: respostasQualificacao,
      infracoes: infracaoData
    };

    const pdfMonkeyRequest = {
      document: {
        document_template_id: DOCUMENT_TEMPLATE_ID,
        status: "pending",
        payload: payload,
        meta: {
          _filename: `MeuRecurso - AIT ${respostasQualificacao.auto_infracao}.pdf`,
        },
      },
    };

    // Enviar a requisição para o PDF Monkey
    const pdfMonkeyResponse = await fetch(PDF_MONKEY_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PDF_MONKEY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pdfMonkeyRequest),
    });

    const pdfMonkeyData = await pdfMonkeyResponse.json();
    if (!pdfMonkeyResponse.ok || !pdfMonkeyData.document?.id) {
      console.error("Erro na integração com PDF Monkey:", pdfMonkeyData);
      return new Response("Erro ao gerar documento no PDF Monkey", { status: 500 });
    }

    // Inserir o registro na tabela solicitacao_pdf
    const { id: id_documento_pdf_monkey } = pdfMonkeyData.document;
    const { error: insertError } = await supabase
      .from("solicitacao_pdf")
      .insert({
        id_pedido,
        id_documento_pdf_monkey,
      });

    if (insertError) {
      console.error("Erro ao salvar dados no Supabase:", insertError);
      return new Response("Erro ao salvar dados no Supabase", { status: 500 });
    }

    // Fazer a requisição para a função get-pdf
    const getPdfRequest = {
      id_pedido,
      id: id_documento_pdf_monkey,
    };

    const getPdfResponse = await fetch(GET_PDF_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(getPdfRequest),
    });

    if (!getPdfResponse.ok) {
      console.error("Erro ao chamar a função get-pdf:", await getPdfResponse.text());
      return new Response("Erro ao chamar a função get-pdf", { status: 500 });
    }

    return new Response(JSON.stringify({ success: true, id_documento_pdf_monkey }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Erro geral na função:", error);
    return new Response("Erro interno", { status: 500 });
  }
});