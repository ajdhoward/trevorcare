// Tests import migration SQL as text — via Vite's ?raw suffix (and the
// vitest-pool-workers Text rule as a fallback for plain .sql imports).
declare module "*?raw" {
  const content: string;
  export default content;
}
declare module "*.sql" {
  const content: string;
  export default content;
}
