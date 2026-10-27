// Request validation and error mapping for the SAP ERP data endpoints.
// The database (erp_commit_for_class) is the authority; this layer rejects
// malformed requests early and turns database errors into safe messages.
import { z } from 'zod';

export const MAX_COMMIT_BYTES = 2_000_000;

const op = z.discriminatedUnion('op', [
  z.object({ op: z.literal('insert'), t: z.string().regex(/^[A-Z0-9_]{2,16}$/), row: z.record(z.string(), z.unknown()) }),
  z.object({
    op: z.literal('update'),
    t: z.string().regex(/^[A-Z0-9_]{2,16}$/),
    key: z.record(z.string(), z.unknown()),
    set: z.record(z.string(), z.unknown()),
    expect: z.record(z.string(), z.unknown()).optional(),
  }),
]);

export const commitSchema = z.object({
  requestId: z.uuid(),
  ops: z.array(op).min(1).max(5000),
});

export type CommitRequest = z.infer<typeof commitSchema>;

export type DbError = { message?: string; details?: string | null; detail?: string | null; code?: string } | null | undefined;
export type MappedError = { status: number; code: string; message: string };

// Constraint names (supabase/migrations/*_sap_erp.sql) → user-facing messages.
const CONSTRAINTS: [RegExp, string][] = [
  [/po_items_gr_qty_check/, 'The received quantity cannot exceed the ordered quantity.'],
  [/po_items_ir_qty_check/, 'The invoiced quantity cannot exceed the quantity received.'],
  [/po_items_value_check/, 'The net value does not match quantity and price.'],
  [/po_items_cost_center_check/, 'Enter a cost center for account assignment category K.'],
  [/po_items_werks_check/, 'The plant does not exist.'],
  [/_tax_check$/, 'The tax amount cannot exceed the gross amount.'],
  [/_period_check$/, 'The posting period does not match the posting date.'],
  [/_mwskz_check$/, 'The tax code is not defined.'],
  [/_zterm_check$/, 'The payment terms are not defined.'],
  [/_bschl_check$/, 'The posting key is not valid for this account type.'],
  [/_blart_check$/, 'The document type is not defined.'],
  [/_waers_check$/, 'The currency is not defined.'],
  [/_(open|cleared)_check$/, 'The clearing information of the item is inconsistent.'],
  [/_reversed_check$/, 'A reversed document needs a reversal document number.'],
  [/invoice_items_posted_check/, 'A posted invoice needs an amount and an accounting document.'],
  [/(wrbtr|menge|netpr|betrw|bitamount|betrz|kwbtr|amount)_check$/, 'Enter an amount or quantity greater than zero.'],
  [/_vendor_fk|_lifnr_fkey/, 'The vendor does not exist.'],
  [/_customer_fk|_partner_fk|_kunnr_fkey/, 'The customer does not exist.'],
  [/_po_fk/, 'The purchase order item does not exist.'],
  [/_ca_fk/, 'The contract account does not exist.'],
  [/_lot_fk/, 'The payment lot does not exist.'],
  [/_bill_fk/, 'The billing document does not exist.'],
  [/_vim_fk/, 'The DP document does not exist.'],
  [/_kostl_fkey/, 'The cost center does not exist.'],
  [/_(hkont|sakto|akont)_fkey/, 'The G/L account does not exist.'],
  [/_bukrs_fkey/, 'The company code does not exist.'],
  [/_matnr_fkey/, 'The material does not exist.'],
];

/** Maps an error from erp_* database functions to a status and a safe message. */
export function mapErpError(error: DbError): MappedError {
  const message = error?.message ?? '';
  const detail = error?.details ?? error?.detail ?? '';
  if (message.includes('erp_invalid')) return { status: 422, code: 'invalid', message: detail || 'The data was rejected.' };
  if (message.includes('erp_conflict')) return { status: 409, code: 'conflict', message: detail || 'The data was changed by another user.' };
  if (message.includes('not_authorized')) return { status: 403, code: 'forbidden', message: 'Your access has ended.' };
  const constraint = /constraint "([a-z0-9_]+)"/.exec(message)?.[1] ?? '';
  if (error?.code === '23514' || error?.code === '23503') {
    const hit = CONSTRAINTS.find(([re]) => re.test(constraint));
    return { status: 422, code: 'invalid', message: hit ? hit[1] : 'A value does not meet the validation rules.' };
  }
  if (error?.code === '23505') return { status: 409, code: 'conflict', message: 'This record already exists.' };
  if (error?.code && /^22/.test(error.code)) return { status: 422, code: 'invalid', message: 'A value has an invalid format.' };
  return { status: 500, code: 'server_error', message: 'The changes could not be saved. Please try again.' };
}
