import { HttpRequest, HttpResponse, HttpTransport } from './http-transport';
import { odataString, SapB1Connector } from './sap-b1.connector';
import { changedAtOf, invoiceFromB1 } from './sap-b1.mapper';

class FakeHttp extends HttpTransport {
  calls: HttpRequest[] = [];
  constructor(private readonly handler: (r: HttpRequest, n: number) => HttpResponse) {
    super();
  }
  async send(r: HttpRequest) {
    this.calls.push(r);
    return this.handler(r, this.calls.length);
  }
}
const json = (o: unknown, status = 200, headers: HttpResponse['headers'] = {}): HttpResponse => ({ status, headers, body: JSON.stringify(o) });
const loginOk = json({ SessionId: 'abc' }, 200, { 'set-cookie': ['B1SESSION=abc; path=/; HttpOnly', 'ROUTEID=.node1; path=/'] });
const cfg = { baseUrl: 'https://sap.example.ao:50000/', companyDb: 'SBODEMOAO' };
const creds = { username: 'manager', password: 'p@ss' };
const inv = (o: Record<string, unknown> = {}) => ({
  DocEntry: 7, DocNum: 1007, NumAtCard: 'FT 2025/7', CardCode: 'C0001', DocDate: '2025-09-01', DocDueDate: '2025-09-30', DocCurrency: 'AOA',
  DocTotal: 1000, PaidToDate: 0, DocTotalFc: 0, PaidFC: 0, DocumentStatus: 'bost_Open', Cancelled: 'tNO', UpdateDate: '2025-09-02', UpdateTime: '10:30:00', ...o,
});
const connector = (h: FakeHttp) => {
  const c = new SapB1Connector(cfg, creds, h);
  (c as unknown as { sleep: () => Promise<void> }).sleep = async () => undefined;
  return c;
};

describe('SapB1 mapper', () => {
  const o = { companyCode: 'SBODEMOAO', localCurrency: 'AOA', referenceField: 'DocNum' as const };
  it('estados: aberta, parcial, liquidada, anulada', () => {
    expect(invoiceFromB1(inv() as never, o)).toMatchObject({ status: 'OPEN', openAmount: '1000.00', amount: '1000.00', externalId: '7', reference: '1007' });
    expect(invoiceFromB1(inv({ PaidToDate: 400 }) as never, o)).toMatchObject({ status: 'PARTIAL', openAmount: '600.00' });
    expect(invoiceFromB1(inv({ PaidToDate: 1000, DocumentStatus: 'bost_Close' }) as never, o)).toMatchObject({ status: 'CLEARED', openAmount: '0.00' });
    expect(invoiceFromB1(inv({ Cancelled: 'tYES' }) as never, o)).toMatchObject({ status: 'CANCELLED', openAmount: '0.00' });
  });
  it('moeda estrangeira usa DocTotalFc/PaidFC', () => {
    expect(invoiceFromB1(inv({ DocCurrency: 'USD', DocTotal: 850000, DocTotalFc: 1000, PaidFC: 250 }) as never, o)).toMatchObject({ currency: 'USD', amount: '1000.00', openAmount: '750.00', status: 'PARTIAL' });
  });
  it('referência pode ser o número do documento impresso', () => {
    expect(invoiceFromB1(inv() as never, { ...o, referenceField: 'NumAtCard' }).reference).toBe('FT 2025/7');
  });
  it('sem valores de vírgula flutuante estranhos', () => {
    expect(invoiceFromB1(inv({ DocTotal: 0.3, PaidToDate: 0.1 }) as never, o).openAmount).toBe('0.20');
  });
  it('changedAt', () => {
    expect(changedAtOf('2025-09-02T00:00:00Z', '10:30:00')).toBe('2025-09-02T10:30:00.000Z');
    expect(changedAtOf('2025-09-02', null)).toBe('2025-09-02T23:59:59.000Z');
    expect(changedAtOf(null, null)).toBeNull();
  });
});

describe('SapB1Connector', () => {
  it('odataString duplica aspas (sem injecção no $filter)', () => {
    expect(odataString("O'Neil' or 1 eq 1")).toBe("'O''Neil'' or 1 eq 1'");
  });

  it('entra, guarda B1SESSION e lê facturas em aberto na carga completa', async () => {
    const h = new FakeHttp((r) => (r.url.endsWith('/Login') ? loginOk : json({ value: [inv()] })));
    const page = await connector(h).invoicesChangedSince(null, null);
    expect(page.items).toHaveLength(1);
    expect(page.next).toBeNull();
    const login = h.calls[0];
    expect(JSON.parse(login.body as string)).toEqual({ CompanyDB: 'SBODEMOAO', UserName: 'manager', Password: 'p@ss' });
    const read = h.calls[1];
    expect(read.headers?.Cookie).toBe('B1SESSION=abc; ROUTEID=.node1');
    expect(read.headers?.Prefer).toBe('odata.maxpagesize=200');
    expect(decodeURIComponent(read.url)).toContain("DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'");
    expect(read.url.startsWith('https://sap.example.ao:50000/b1s/v1/Invoices?')).toBe(true);
  });

  it('segue o nextLink como caminho relativo e rejeita outro anfitrião', async () => {
    const h = new FakeHttp((r, n) => (n === 1 ? loginOk : json({ value: [inv()], 'odata.nextLink': 'Invoices?$skip=200&$select=DocEntry' })));
    const c = connector(h);
    const p1 = await c.invoicesChangedSince(null, null);
    expect(p1.next).toBe('/Invoices?$skip=200&$select=DocEntry');
    await c.invoicesChangedSince(null, p1.next);
    expect(h.calls[2].url).toBe('https://sap.example.ao:50000/b1s/v1/Invoices?$skip=200&$select=DocEntry');

    const evil = connector(new FakeHttp((r, n) => (n === 1 ? loginOk : json({ value: [], 'odata.nextLink': 'https://evil.example/steal' }))));
    await expect(evil.invoicesChangedSince(null, null)).rejects.toThrow(/noutro endereço/);
  });

  it('incremental filtra por UpdateDate e refina pela hora', async () => {
    const h = new FakeHttp((r) =>
      r.url.endsWith('/Login') ? loginOk : json({ value: [inv({ DocEntry: 1, UpdateTime: '08:00:00' }), inv({ DocEntry: 2, UpdateTime: '11:00:00' })] }),
    );
    const page = await connector(h).invoicesChangedSince('2025-09-02T09:00:00.000Z', null);
    expect(decodeURIComponent(h.calls[1].url)).toContain("UpdateDate ge '2025-09-02'");
    expect(page.items.map((i) => i.externalId)).toEqual(['2']);
  });

  it('renova a sessão num 401', async () => {
    let reads = 0;
    const h = new FakeHttp((r) => {
      if (r.url.endsWith('/Login')) return loginOk;
      return ++reads === 1 ? json({ error: { message: { value: 'Invalid session' } } }, 401) : json({ value: [inv()] });
    });
    const page = await connector(h).invoicesChangedSince(null, null);
    expect(page.items).toHaveLength(1);
    expect(h.calls.filter((c) => c.url.endsWith('/Login'))).toHaveLength(2);
  });

  it('credenciais recusadas dão mensagem de negócio; 5xx tenta de novo', async () => {
    const bad = new FakeHttp(() => json({ error: { code: -1, message: { value: 'Invalid user' } } }, 401));
    await expect(connector(bad).testConnection()).rejects.toThrow(/recusou o início de sessão: Invalid user/);

    let n = 0;
    const flaky = new FakeHttp((r) => (r.url.endsWith('/Login') ? loginOk : ++n < 3 ? json({}, 503) : json({ value: [] })));
    await expect(connector(flaky).invoicesChangedSince(null, null)).resolves.toMatchObject({ items: [] });
    expect(n).toBe(3);
  });

  it('procura por ids e referências em lotes, com filtro escapado', async () => {
    const h = new FakeHttp((r) => (r.url.endsWith('/Login') ? loginOk : json({ value: [inv()] })));
    const c = connector(h);
    await c.invoicesByIds(['7', 'x; drop', '9']);
    expect(decodeURIComponent(h.calls[1].url)).toContain('DocEntry eq 7 or DocEntry eq 9');
    expect(decodeURIComponent(h.calls[1].url)).not.toContain('drop');
    const h2 = new FakeHttp((r) => (r.url.endsWith('/Login') ? loginOk : json({ value: [] })));
    await new SapB1Connector({ ...cfg, referenceField: 'NumAtCard' }, creds, h2).invoicesByReference(["FT 1'2"]);
    expect(decodeURIComponent(h2.calls[1].url)).toContain("NumAtCard eq 'FT 1''2'");
  });

  it('clientes mapeados do BusinessPartners', async () => {
    const h = new FakeHttp((r) => (r.url.endsWith('/Login') ? loginOk : json({ value: [{ CardCode: 'C0001', CardName: ' Empresa X ', FederalTaxID: '5417012345', EmailAddress: 'a@x.ao', Phone1: '222', Cellular: '923', Address: 'Luanda' }] })));
    const [cu] = await connector(h).customersByIds(['C0001']);
    expect(cu).toMatchObject({ externalId: 'C0001', name: 'Empresa X', nif: '5417012345', phone: '923', isCompany: true, companyCode: 'SBODEMOAO' });
  });

  it('credores: filiais (BPL) se existirem, senão a própria empresa', async () => {
    const withBpl = new FakeHttp((r) => (r.url.endsWith('/Login') ? loginOk : json({ value: [{ BPLID: 1, BPLName: 'Filial Luanda', Street: 'Rua A', City: 'Luanda' }, { BPLID: 2, BPLName: 'Filial Huambo' }] })));
    expect((await connector(withBpl).companies()).map((c) => [c.code, c.name])).toEqual([['1', 'Filial Luanda'], ['2', 'Filial Huambo']]);
    const none = new FakeHttp((r) => (r.url.endsWith('/Login') ? loginOk : r.url.includes('BusinessPlaces') ? json({ value: [] }) : json({ CompanyName: 'Empresa Demo, Lda', EMail: 'a@b.ao' })));
    expect(await connector(none).companies()).toEqual([{ code: 'SBODEMOAO', name: 'Empresa Demo, Lda', email: 'a@b.ao', phone: null, address: null }]);
    expect(invoiceFromB1(inv({ BPL_IDAssignedToInvoice: 2 }) as never, { companyCode: 'SBODEMOAO', localCurrency: 'AOA', referenceField: 'DocNum' }).companyCode).toBe('2');
  });

  it('testConnection devolve a empresa e a contagem', async () => {
    const h = new FakeHttp((r) => (r.url.endsWith('/Login') ? loginOk : json({ 'odata.count': '42', value: [] })));
    await expect(connector(h).testConnection()).resolves.toMatchObject({ companyCodes: ['SBODEMOAO'], openInvoices: 42 });
  });
});
