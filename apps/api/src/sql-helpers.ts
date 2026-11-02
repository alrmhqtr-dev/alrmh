export const addMonthsSql = (base: string, param: string) => `(${base} + (${param} || ' months')::interval)`;
