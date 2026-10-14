import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiError } from '../../lib/api';
import { showToast } from '../../store/toast';
import {
  CreateBillLine,
  PosProduct,
  posLookupExact,
  useCreateBill,
  useHoldBill,
  usePosProductSearch,
  fetchPosBillById,
} from '../../lib/pos';

// A cart line held in local state before checkout. Weight-based units allow a
// decimal quantity; piece units step by 1.
interface CartLine {
  key: string;
  productId: number | null;
  name: string;
  sku: string | null;
  unit: string;
  quantity: number;
  rate: number;
  taxRate: number;
  isManual: boolean;
  stock?: number;
}

// Units billed by weight/volume accept decimal quantities (0.5 kg, 250 g …).
const DECIMAL_UNITS = new Set(['g', 'kg', 'mg', 'ml', 'l']);
const isDecimalUnit = (u: string) => DECIMAL_UNITS.has((u || '').toLowerCase());
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** uuid for the idempotency key (crypto.randomUUID in all evergreen browsers; tiny fallback). */
function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const lineBase = (l: CartLine) => round2(l.quantity * l.rate);
const lineTax = (l: CartLine) => round2(lineBase(l) * (l.taxRate / 100));
const lineTotal = (l: CartLine) => round2(lineBase(l) + lineTax(l));

/**
 * Fast billing / POS screen (design §4) — responsive two-pane layout: a product
 * search / scan pane and the live cart. Optimised for a quick, minimal-click
 * checkout on phone, tablet and desktop.
 *
 * The idempotency key is created once per cart (useRef) and reused on every
 * retry so a double-click / refresh never deducts stock twice (acceptance d).
 * All totals shown here are a client preview; the server recomputes them from
 * the authoritative product price/tax_rate on checkout.
 */
export default function AdminPos() {
  const [params] = useSearchParams();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [discount, setDiscount] = useState(0);
  const [custName, setCustName] = useState('');
  const [custMobile, setCustMobile] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'upi' | 'other'>('cash');
  const [amountPaid, setAmountPaid] = useState<string>('');
  const [lastBillNo, setLastBillNo] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  // One idempotency key per cart; regenerated after a successful checkout so the
  // NEXT bill is a new operation while retries of THIS bill stay idempotent.
  const idemKey = useRef<string>(uuid());

  const { data: results = [], isFetching } = usePosProductSearch(search);
  const createBill = useCreateBill();
  const holdBill = useHoldBill();

  // Reopen a held bill passed as ?reopen=<id>.
  useEffect(() => {
    const reopen = params.get('reopen');
    if (!reopen) return;
    const id = Number(reopen);
    if (!Number.isFinite(id)) return;
    fetchPosBillById(id)
      .then((bill) => {
        setCart(
          bill.items.map((it) => ({
            key: uuid(),
            productId: it.product_id,
            name: it.name,
            sku: it.sku,
            unit: it.unit,
            quantity: it.quantity,
            rate: it.rate,
            taxRate: it.tax_rate,
            isManual: it.is_manual,
          }))
        );
        setDiscount(bill.discount);
        setCustName(bill.customer_name || '');
        setCustMobile(bill.customer_mobile || '');
        showToast(`Held bill reopened`, 'info');
      })
      .catch((e) => showToast(apiError(e), 'error'));
  }, [params]);

  const subtotal = round2(cart.reduce((s, l) => s + lineBase(l), 0));
  const taxTotal = round2(cart.reduce((s, l) => s + lineTax(l), 0));
  const clampedDiscount = Math.min(Math.max(0, discount || 0), subtotal);
  const grandTotal = round2(subtotal - clampedDiscount + taxTotal);

  function addProduct(p: PosProduct) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === p.id && !l.isManual);
      if (existing) {
        return prev.map((l) => (l === existing ? { ...l, quantity: round3(l.quantity + 1) } : l));
      }
      return [
        ...prev,
        {
          key: uuid(),
          productId: p.id,
          name: p.name,
          sku: p.sku,
          unit: p.unit,
          quantity: 1,
          rate: p.price,
          taxRate: p.tax_rate,
          isManual: false,
          stock: p.stock,
        },
      ];
    });
    setSearch('');
    searchRef.current?.focus();
  }

  function addManualLine() {
    setCart((prev) => [
      ...prev,
      { key: uuid(), productId: null, name: '', sku: null, unit: 'pcs', quantity: 1, rate: 0, taxRate: 0, isManual: true },
    ]);
  }

  function updateLine(key: string, patch: Partial<CartLine>) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }
  function stepQty(l: CartLine, delta: number) {
    const step = isDecimalUnit(l.unit) ? 0.1 : 1;
    const next = round3(Math.max(step, l.quantity + delta * step));
    updateLine(l.key, { quantity: next });
  }

  // Enter in the search box = barcode/SKU scan. A hardware scanner types fast and
  // ends with Enter; we resolve the exact code and add it in one shot.
  async function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const term = search.trim();
    if (!term) return;
    try {
      const p = await posLookupExact(term);
      if (p) addProduct(p);
      else showToast(`No product for "${term}"`, 'error');
    } catch (err) {
      showToast(apiError(err), 'error');
    }
  }

  function buildPayload(status: 'completed' | 'held'): { items: CreateBillLine[] } & Record<string, unknown> {
    return {
      status,
      idempotencyKey: idemKey.current,
      customer: {
        ...(custName.trim() ? { name: custName.trim() } : {}),
        ...(custMobile.trim() ? { mobile: custMobile.trim() } : {}),
      },
      items: cart.map((l) => ({
        productId: l.productId,
        name: l.name.trim(),
        unit: l.unit,
        quantity: l.quantity,
        rate: l.isManual ? l.rate : undefined,
        taxRate: l.isManual ? l.taxRate : undefined,
        isManual: l.isManual,
      })),
      discount: clampedDiscount,
      payment: {
        method: payMethod,
        ...(amountPaid.trim() !== '' ? { amountPaid: Number(amountPaid) } : {}),
      },
    };
  }

  function validateCart(): string | null {
    if (!cart.length) return 'Add at least one item.';
    for (const l of cart) {
      if (!l.name.trim()) return 'A manual item needs a name.';
      if (!(l.quantity > 0)) return 'Quantity must be greater than 0.';
      if (l.isManual && !(l.rate >= 0)) return 'Manual item rate must be 0 or more.';
    }
    return null;
  }

  async function charge() {
    const err = validateCart();
    if (err) return showToast(err, 'error');
    try {
      const res = await createBill.mutateAsync(buildPayload('completed') as never);
      const billNo = res.bill.bill_no;
      setLastBillNo(billNo);
      showToast(res.idempotent ? `Bill ${billNo} (already saved)` : `✅ Bill ${billNo} saved`, 'success');
      // New operation for the next customer.
      resetCart();
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  async function hold() {
    const err = validateCart();
    if (err) return showToast(err, 'error');
    try {
      const res = await holdBill.mutateAsync(buildPayload('held') as never);
      showToast(`Bill held (#${res.bill.id})`, 'info');
      resetCart();
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  function resetCart() {
    setCart([]);
    setDiscount(0);
    setCustName('');
    setCustMobile('');
    setAmountPaid('');
    setPayMethod('cash');
    idemKey.current = uuid();
    searchRef.current?.focus();
  }

  const money = (n: number) => `₹${n.toFixed(2)}`;
  const busy = createBill.isPending || holdBill.isPending;

  return (
    <div className="pos-layout" style={styles.layout}>
      {/* Search / scan + results */}
      <div style={styles.pane}>
        <div style={styles.card}>
          <input
            ref={searchRef}
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="🔎 Search or scan — name, SKU or barcode"
            style={styles.search}
            aria-label="Search products by name, SKU or barcode"
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={addManualLine} style={styles.secondaryBtn}>➕ Manual item</button>
            {isFetching && <span style={{ alignSelf: 'center', color: 'var(--gray)', fontSize: 12 }}>Searching…</span>}
          </div>
        </div>

        <div style={{ ...styles.card, marginTop: 12, padding: 0, overflow: 'hidden' }}>
          {search.trim() === '' ? (
            <p style={styles.hint}>Type a product name or scan a barcode to begin.</p>
          ) : results.length === 0 ? (
            <p style={styles.hint}>{isFetching ? 'Searching…' : 'No matching products.'}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: '60vh', overflowY: 'auto' }}>
              {results.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => addProduct(p)} style={styles.resultRow}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: 'block' }}>{p.name}</strong>
                      <small style={{ color: 'var(--gray)' }}>
                        {p.sku ? `SKU ${p.sku} · ` : ''}{p.barcode ? `#${p.barcode} · ` : ''}Stock {p.stock} {p.unit}
                      </small>
                    </span>
                    <span style={{ fontWeight: 700, color: 'var(--primary-dark)' }}>{money(p.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Cart + checkout */}
      <div style={styles.pane}>
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>🧾 Current Bill</h3>
            {cart.length > 0 && (
              <button type="button" onClick={resetCart} style={styles.linkBtn}>Clear</button>
            )}
          </div>

          {cart.length === 0 ? (
            <p style={styles.hint}>No items yet. Add products from the left.</p>
          ) : (
            <div style={{ marginTop: 10 }}>
              {cart.map((l) => (
                <div key={l.key} style={styles.cartLine}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {l.isManual ? (
                      <input
                        value={l.name}
                        onChange={(e) => updateLine(l.key, { name: e.target.value })}
                        placeholder="Item name"
                        style={styles.inlineInput}
                        aria-label="Manual item name"
                      />
                    ) : (
                      <strong style={{ display: 'block' }}>{l.name}</strong>
                    )}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                      {l.isManual && (
                        <>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={l.rate}
                            onChange={(e) => updateLine(l.key, { rate: Number(e.target.value) })}
                            style={styles.numInput}
                            aria-label="Rate"
                          />
                          <input
                            value={l.unit}
                            onChange={(e) => updateLine(l.key, { unit: e.target.value })}
                            style={{ ...styles.numInput, width: 56 }}
                            aria-label="Unit"
                          />
                        </>
                      )}
                      {!l.isManual && (
                        <small style={{ color: 'var(--gray)' }}>{money(l.rate)} / {l.unit}</small>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button type="button" onClick={() => stepQty(l, -1)} style={styles.stepBtn} aria-label="Decrease quantity">−</button>
                    <input
                      type="number"
                      min={0}
                      step={isDecimalUnit(l.unit) ? '0.001' : '1'}
                      value={l.quantity}
                      onChange={(e) => updateLine(l.key, { quantity: round3(Math.max(0, Number(e.target.value))) })}
                      style={styles.qtyInput}
                      aria-label={`Quantity in ${l.unit}`}
                    />
                    <button type="button" onClick={() => stepQty(l, 1)} style={styles.stepBtn} aria-label="Increase quantity">+</button>
                  </div>

                  <div style={{ width: 84, textAlign: 'right', fontWeight: 700 }}>{money(lineTotal(l))}</div>
                  <button type="button" onClick={() => removeLine(l.key)} style={styles.removeBtn} aria-label="Remove item">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ ...styles.card, marginTop: 12 }}>
          <div style={styles.fieldRow}>
            <label style={styles.label}>Customer name (optional)
              <input value={custName} onChange={(e) => setCustName(e.target.value)} style={styles.textInput} />
            </label>
            <label style={styles.label}>Mobile (optional)
              <input value={custMobile} onChange={(e) => setCustMobile(e.target.value.replace(/\D/g, ''))} maxLength={10} inputMode="numeric" style={styles.textInput} />
            </label>
          </div>

          <div style={styles.fieldRow}>
            <label style={styles.label}>Discount ₹
              <input type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} style={styles.textInput} />
            </label>
            <label style={styles.label}>Amount paid ₹ (optional)
              <input type="number" min={0} value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder={grandTotal.toFixed(2)} style={styles.textInput} />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, margin: '4px 0 10px' }}>
            {(['cash', 'upi', 'other'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPayMethod(m)}
                style={{ ...styles.payBtn, ...(payMethod === m ? styles.payBtnActive : {}) }}
              >
                {m === 'cash' ? '💵 Cash' : m === 'upi' ? '📲 UPI' : '🔁 Other'}
              </button>
            ))}
          </div>

          <div style={styles.totals}>
            <div style={styles.totalRow}><span>Subtotal</span><span>{money(subtotal)}</span></div>
            {clampedDiscount > 0 && <div style={styles.totalRow}><span>Discount</span><span>− {money(clampedDiscount)}</span></div>}
            {taxTotal > 0 && <div style={styles.totalRow}><span>Tax</span><span>{money(taxTotal)}</span></div>}
            <div style={{ ...styles.totalRow, ...styles.grand }}><span>Payable</span><span>{money(grandTotal)}</span></div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button type="button" onClick={hold} disabled={busy || !cart.length} style={styles.holdBtn}>Hold</button>
            <button type="button" onClick={charge} disabled={busy || !cart.length} style={styles.chargeBtn}>
              {busy ? '⏳ Saving…' : `Charge ${money(grandTotal)}`}
            </button>
          </div>

          {lastBillNo && (
            <p style={{ marginTop: 10, fontSize: 13, color: 'var(--green, #087a3d)' }}>
              ✅ Last bill <strong>{lastBillNo}</strong> — open it from Billing History to print or share.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  layout: { display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(300px, 1.2fr)', gap: 16, alignItems: 'start' },
  pane: { minWidth: 0 },
  card: { background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 14, boxShadow: 'var(--shadow)' },
  search: { width: '100%', padding: '12px 14px', fontSize: 16, border: '1px solid var(--border)', borderRadius: 10, boxSizing: 'border-box' },
  hint: { padding: 20, textAlign: 'center', color: 'var(--gray)', fontSize: 13, margin: 0 },
  resultRow: { display: 'flex', gap: 10, alignItems: 'center', width: '100%', textAlign: 'left', padding: '11px 14px', border: 0, borderBottom: '1px solid #f0f0f0', background: 'white', cursor: 'pointer', font: 'inherit' },
  cartLine: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #f3f3f3' },
  inlineInput: { width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, boxSizing: 'border-box' },
  numInput: { width: 76, padding: '5px 7px', border: '1px solid var(--border)', borderRadius: 6 },
  qtyInput: { width: 60, padding: '6px 4px', textAlign: 'center', border: '1px solid var(--border)', borderRadius: 6 },
  stepBtn: { width: 30, height: 30, border: '1px solid var(--border)', borderRadius: 6, background: '#fafafa', fontSize: 18, cursor: 'pointer', lineHeight: 1 },
  removeBtn: { border: 0, background: 'none', color: '#c62828', cursor: 'pointer', fontSize: 15, padding: 4 },
  fieldRow: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  label: { flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--gray)', fontWeight: 600, marginBottom: 8 },
  textInput: { padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14 },
  payBtn: { flex: 1, padding: '9px 6px', border: '1px solid var(--border)', borderRadius: 8, background: 'white', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  payBtnActive: { background: 'var(--primary-light)', borderColor: 'var(--primary)', color: 'var(--primary-dark)' },
  totals: { borderTop: '1px dashed var(--border)', paddingTop: 10 },
  totalRow: { display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 14 },
  grand: { fontWeight: 800, fontSize: 18, color: 'var(--primary-dark)', borderTop: '2px solid var(--border)', marginTop: 6, paddingTop: 8 },
  holdBtn: { flex: '0 0 90px', padding: '12px', border: '1px solid var(--border)', borderRadius: 10, background: 'white', fontWeight: 700, cursor: 'pointer' },
  chargeBtn: { flex: 1, padding: '12px', border: 0, borderRadius: 10, background: 'var(--primary)', color: 'white', fontWeight: 800, fontSize: 16, cursor: 'pointer' },
  secondaryBtn: { padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  linkBtn: { border: 0, background: 'none', color: 'var(--primary-dark)', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
};
