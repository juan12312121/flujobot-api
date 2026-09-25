/** Resultado paginado; la presentación lo envía como { data: items, meta }. */
export class Pagina {
  constructor(items, { total, pagina, porPagina }) {
    this.items = items;
    this.meta = { total, pagina, porPagina };
  }
}
