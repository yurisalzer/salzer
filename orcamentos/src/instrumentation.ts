export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { inicializar } = await import("./servidor/inicializacao");
    await inicializar();
  }
}
