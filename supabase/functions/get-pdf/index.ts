import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROJETO_URL = Deno.env.get("PROJETO_URL")!;
const PROJETO_KEY = Deno.env.get("PROJETO_KEY")!;

const supabase = createClient(PROJETO_URL, PROJETO_KEY);

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const { document } = await req.json();

    if (!document || !document.id || !document.download_url || !document.filename) {
      return new Response("Missing required document fields", { status: 400 });
    }

    const documentId = document.id;
    const downloadUrl = document.download_url;
    const filename = document.filename;

    // Consultar a tabela "solicitacao_pdf" para obter o id_pedido correspondente
    const { data: solicitacaoData, error: solicitacaoError } = await supabase
      .from("solicitacao_pdf")
      .select("id_pedido")
      .eq("id_documento_pdf_monkey", documentId)
      .single();

    if (solicitacaoError || !solicitacaoData) {
      console.error("Erro ao consultar solicitacao_pdf:", solicitacaoError);
      return new Response("Erro ao consultar solicitacao_pdf", { status: 500 });
    }

    const idPedido = solicitacaoData.id_pedido;

    // Fazer download do PDF
    const pdfResponse = await fetch(downloadUrl);
    if (!pdfResponse.ok) {
      return new Response("Erro ao baixar o PDF", { status: 500 });
    }

    const pdfData = await pdfResponse.arrayBuffer();

    // Salvar o PDF no bucket "recursos_pdf"
    const { error: uploadError } = await supabase.storage
      .from("recursos_pdf")
      .upload(filename, new Blob([pdfData]), {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      console.error("Erro ao salvar PDF no Storage:", uploadError);
      return new Response(`Erro ao salvar PDF no Storage: ${uploadError.message}`, { status: 500 });
    }

    // Gerar URL pública para o PDF
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from("recursos_pdf")
      .createSignedUrl(filename, 31 * 24 * 60 * 60); // 31 dias em segundos

    if (signedUrlError || !signedUrlData) {
      console.error("Erro ao gerar URL pública:", signedUrlError);
      return new Response(`Erro ao gerar URL do PDF: ${signedUrlError?.message}`, { status: 500 });
    }

    const pdfUrl = signedUrlData.signedUrl;

    // Inserir registro na tabela "recursos_gerados"
    const { error: insertError } = await supabase.from("recursos_gerados").insert({
      id_pedido: idPedido,
      id_documento_pdf_monkey: documentId,
      url_pdf_supabase_storage: pdfUrl,
    });

    if (insertError) {
      console.error("Erro ao inserir registro na tabela recursos_gerados:", insertError);
      return new Response(`Erro ao inserir registro no banco: ${insertError.message}`, { status: 500 });
    }

    return new Response(
      JSON.stringify({ message: "Webhook processado com sucesso", pdfUrl }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Erro na Edge Function:", error);
    return new Response("Erro interno", { status: 500 });
  }
});
