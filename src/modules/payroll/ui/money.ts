// Integer VND → "20.000.000 đ". Plain module (server and client).
const formatter = new Intl.NumberFormat("vi-VN");
export const formatVnd = (amount: number): string => `${formatter.format(amount)} đ`;
