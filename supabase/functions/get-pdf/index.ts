import { serve } from "https://deno.land/std@0.131.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROJETO_URL = Deno.env.get("PROJETO_URL")!;
const PROJETO_KEY = Deno.env.get("PROJETO_KEY")!;

const supabase = createClient(PROJETO_URL, PROJETO_KEY);

// Chave do PDF Monkey inserida diretamente
const PDF_MONKEY_API_KEY = "3fu4hckGSC9Qzevkk3fa";

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const { id, id_pedido } = await req.json();
    if (!id || !id_pedido) {
      return new Response("Missing required fields", { status: 400 });
    }

    const pdfMonkeyApiUrl = `https://api.pdfmonkey.io/api/v1/documents/${id}`;

    // Verifica status do PDF até que seja "success" e tenha "download_url"
    let documentData = null;
    for (let i = 0; i < 10; i++) { // Tenta até 10 vezes
      const response = await fetch(pdfMonkeyApiUrl, {
        headers: {
          Authorization: `Bearer ${PDF_MONKEY_API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        return new Response("Erro ao consultar PDF Monkey", { status: 500 });
      }

      const { document } = await response.json();
      if (document.status === "success" && document.download_url) {
        documentData = document;
        break;
      }

      await new Promise((res) => setTimeout(res, 5000)); // Aguarda 5 segundos antes de tentar novamente
    }

    if (!documentData) {
      return new Response("PDF não gerado após várias tentativas", { status: 500 });
    }

    const { download_url, filename } = documentData;

    // Faz download do PDF
    const pdfResponse = await fetch(download_url);
    if (!pdfResponse.ok) {
      return new Response("Erro ao baixar o PDF", { status: 500 });
    }

    const pdfData = await pdfResponse.arrayBuffer();

    // Salva o PDF diretamente no bucket "recursos_pdf" sem criar subpastas
    const filePath = filename;
    const { error: uploadError } = await supabase.storage
      .from("recursos_pdf")
      .upload(filePath, new Blob([pdfData]), {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      return new Response(`Erro ao salvar PDF no Storage: ${uploadError.message}`, { status: 500 });
    }

    // Gera URL pública válida por 31 dias
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from("recursos_pdf")
      .createSignedUrl(filePath, 31 * 24 * 60 * 60); // 31 dias em segundos

    if (signedUrlError || !signedUrlData) {
      return new Response(`Erro ao gerar URL do PDF: ${signedUrlError?.message}`, { status: 500 });
    }

    const pdfUrl = signedUrlData.signedUrl;

    // Insere registro na tabela "recursos_gerados"
    const { error: insertError } = await supabase.from("recursos_gerados").insert({
      id_pedido,
      id_documento_pdf_monkey: id,
      url_pdf_supabase_storage: pdfUrl,
    });

    if (insertError) {
      return new Response(`Erro ao inserir registro no banco: ${insertError.message}`, { status: 500 });
    }

    return new Response(
      JSON.stringify({ message: "PDF processado e salvo com sucesso", pdfUrl }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Erro na Edge Function:", error);
    return new Response("Erro interno", { status: 500 });
  }
});
