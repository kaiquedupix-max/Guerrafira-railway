import QRCode from "qrcode";

/**
 * Gera um QR code PNG a partir de qualquer texto (código PIX, URL, etc).
 * Retorna um Buffer PNG pronto para ser enviado como attachment no Discord.
 */
export async function generateQrCodeBuffer(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    type:   "png",
    width:  512,
    margin: 2,
    color:  { dark: "#000000ff", light: "#ffffffff" },
    errorCorrectionLevel: "M",
  }) as Promise<Buffer>;
}
