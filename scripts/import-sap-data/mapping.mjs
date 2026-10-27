// Auditable mapping from the SAP ERP workbook to the database (schema erp).
//
// Each data sheet maps to one module table (the "SAP table" column of the
// workbook's Read Me sheet). Column headers carry the technical field name in
// parentheses, e.g. "Vendor (LIFNR)"; the importer matches on that name.
// Changing this file changes MAPPING_VERSION, which is stored with every import.

export const MAPPING_VERSION = 'sap-workbook-v1';

/** Field kinds: text keeps the cell text (leading zeros intact), num/int are numbers, date is YYYY-MM-DD. */
const spec = (s) => s.split(' ').map((f) => {
  const [name, kind] = f.split(':');
  return { name, kind };
});

export const SHEETS = [
  { sheet: 'Company Codes', code: 'T001', scope: 'org', key: ['BUKRS'], required: ['BUKRS', 'BUTXT', 'WAERS'],
    columns: spec('BUKRS:text BUTXT:text ORT01:text LAND1:text WAERS:text KTOPL:text') },
  { sheet: 'GL Accounts', code: 'SKA1', scope: 'org', key: ['SAKNR'], required: ['SAKNR', 'TXT50'],
    columns: spec('SAKNR:text TXT50:text KTOKS:text GLTYPE:text XOPVW:text RECON:text') },
  { sheet: 'Cost Centers', code: 'CSKS', scope: 'org', key: ['KOSTL'], required: ['KOSTL', 'KTEXT', 'BUKRS'],
    columns: spec('KOSTL:text KTEXT:text BUKRS:text VERAK:text PRCTR:text') },
  { sheet: 'Materials', code: 'MARA', scope: 'org', key: ['MAKTX'], required: ['MAKTX', 'MEINS'],
    columns: spec('MATNR:text MAKTX:text MEINS:text MATKL:text WGBEZ:text SAKTO:text PRICE:num') },
  { sheet: 'Vendors', code: 'LFA1', scope: 'workspace', key: ['LIFNR'], required: ['LIFNR', 'NAME1', 'BUKRS', 'WAERS'],
    columns: spec('LIFNR:text NAME1:text SORTL:text STRAS:text ORT01:text PSTLZ:text REGIO:text LAND1:text TELF1:text SMTP_ADDR:text CONTACT:text STCD3:text J_1IPANNO:text BANKA:text BANKL:text BANKN:text BUKRS:text AKONT:text ZTERM:text EKORG:text WAERS:text KTOKK:text ERDAT:date') },
  { sheet: 'Customers', code: 'KNA1', scope: 'workspace', key: ['KUNNR'], required: ['KUNNR', 'NAME1', 'BUKRS', 'WAERS'],
    columns: spec('KUNNR:text NAME1:text SORTL:text STRAS:text ORT01:text PSTLZ:text REGIO:text LAND1:text TELF1:text SMTP_ADDR:text STCD3:text BUKRS:text AKONT:text ZTERM:text VKORG:text VTWEG:text SPART:text KLIMK:num WAERS:text KTOKD:text ERDAT:date') },
  { sheet: 'Vendor Documents', code: 'BSIK', scope: 'workspace', key: ['BELNR'],
    required: ['BELNR', 'BUKRS', 'GJAHR', 'BLART', 'BLDAT', 'BUDAT', 'MONAT', 'LIFNR', 'BSCHL', 'SHKZG', 'WRBTR', 'WAERS', 'WMWST', 'STATUS'],
    columns: spec('BELNR:text BUKRS:text GJAHR:text BLART:text BLDAT:date BUDAT:date MONAT:int LIFNR:text BSCHL:text SHKZG:text UMSKZ:text WRBTR:num WAERS:text MWSKZ:text WMWST:num HKONT:text KOSTL:text GSBER:text EBELN:text XBLNR:text BKTXT:text SGTXT:text ZUONR:text ZTERM:text ZFBDT:date FAEDT:date STATUS:text AUGBL:text AUGDT:date STBLG:text USNAM:text') },
  { sheet: 'Customer Documents', code: 'BSID', scope: 'workspace', key: ['BELNR'],
    required: ['BELNR', 'BUKRS', 'GJAHR', 'BLART', 'BLDAT', 'BUDAT', 'MONAT', 'KUNNR', 'BSCHL', 'SHKZG', 'WRBTR', 'WAERS', 'WMWST', 'STATUS'],
    columns: spec('BELNR:text BUKRS:text GJAHR:text BLART:text BLDAT:date BUDAT:date MONAT:int KUNNR:text BSCHL:text SHKZG:text WRBTR:num WAERS:text MWSKZ:text WMWST:num HKONT:text GSBER:text VBELN:text XBLNR:text BKTXT:text SGTXT:text ZUONR:text ZTERM:text ZFBDT:date FAEDT:date STATUS:text AUGBL:text AUGDT:date USNAM:text') },
  { sheet: 'Purchase Orders', code: 'EKPO', scope: 'workspace', key: ['EBELN', 'EBELP'],
    required: ['EBELN', 'EBELP', 'BSART', 'BUKRS', 'EKORG', 'EKGRP', 'LIFNR', 'BEDAT', 'TXZ01', 'MENGE', 'MEINS', 'NETPR', 'PEINH', 'WAERS', 'NETWR', 'WERKS', 'EINDT', 'WEMNG', 'REMNG', 'STATUS'],
    columns: spec('EBELN:text EBELP:text BSART:text BUKRS:text EKORG:text EKGRP:text LIFNR:text BEDAT:date MATNR:text TXZ01:text MATKL:text MENGE:num MEINS:text NETPR:num PEINH:int WAERS:text NETWR:num WERKS:text LGORT:text EINDT:date KNTTP:text KOSTL:text SAKTO:text AUFNR:text PS_PSP_PNR:text ANLN1:text VBELN:text FRGKE:text WEMNG:num REMNG:num ERNAM:text STATUS:text') },
  { sheet: 'Goods Receipts', code: 'MSEG', scope: 'workspace', key: ['MBLNR', 'ZEILE'],
    required: ['MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'BLDAT', 'BUDAT', 'EBELN', 'EBELP', 'MENGE', 'MEINS', 'WERKS', 'STATUS'],
    columns: spec('MBLNR:text MJAHR:text ZEILE:text BWART:text BLDAT:date BUDAT:date EBELN:text EBELP:text MATNR:text MAKTX:text MENGE:num MEINS:text WERKS:text LGORT:text XBLNR:text FRBNR:text BKTXT:text USNAM:text STATUS:text') },
  { sheet: 'MIRO Invoices', code: 'RBKP', scope: 'workspace', key: ['BELNR', 'EBELN', 'EBELP'],
    required: ['BELNR', 'GJAHR', 'BUKRS', 'BLART', 'TYPE', 'LIFNR', 'BLDAT', 'BUDAT', 'RMWWR', 'WMWST', 'WAERS', 'EBELN', 'EBELP', 'MENGE', 'STATUS'],
    columns: spec('BELNR:text GJAHR:text BUKRS:text BLART:text TYPE:text LIFNR:text XBLNR:text BLDAT:date BUDAT:date RMWWR:num WMWST:num MWSKZ:text WAERS:text EBELN:text EBELP:text MENGE:num ZTERM:text ZLSPR:text FIDOC:text STATUS:text STBLG:text SGTXT:text USNAM:text') },
  { sheet: 'VIM Documents', code: 'VIMDP', scope: 'workspace', key: ['DOCID'], required: ['DOCID', 'BUKRS', 'GROSS', 'WAERS', 'PROC_STATUS', 'TAB'],
    columns: spec('DOCID:text BUKRS:text LIFNR:text NAME1:text XBLNR:text BLDAT:date GROSS:num WAERS:text DOCTYPE:text INVTYPE:text EBELN:text EKGRP:text WERKS:text EKORG:text REGIO:text LAND1:text SOURCE:text BARCODE:text REQUISITIONER:text WORKORDER:text EXCEPTION:text PROC_STATUS:text ROLE:text AGENT:text TAB:text CREATED:date DUEDATE:date INVDOC:text FIDOC:text TRANS_EVENT:text') },
  { sheet: 'Work Items', code: 'SWWWIHEAD', scope: 'workspace', key: ['WI_ID'], required: ['WI_ID', 'WI_STAT'],
    columns: spec('WI_ID:text WI_TYPE:text WI_STAT:text WI_PRIO:text WI_DSTAT:text WI_RH_TASK:text TASKGROUP:text TOPTASK:text WI_TEXT:text WI_CD:date WI_CT:text WI_AAGENT:text TOPLEVEL:text DOCID:text') },
  { sheet: 'Contract Accounts', code: 'FKKVKP', scope: 'workspace', key: ['VKONT'], required: ['VKONT', 'GPART', 'BUKRS'],
    columns: spec('VKONT:text GPART:text NAME:text BUKRS:text VKTYP:text VTREF:text ERDAT:date VALIDFROM:date STATUS:text') },
  { sheet: 'FICA Open Items', code: 'DFKKOP', scope: 'workspace', key: ['OPBEL'],
    required: ['OPBEL', 'OPUPK', 'GPART', 'VKONT', 'BUKRS', 'BLDAT', 'BUDAT', 'BETRW', 'WAERS', 'STATUS'],
    columns: spec('OPBEL:text OPUPK:text GPART:text VKONT:text VTREF:text BUKRS:text HVORG:text TVORG:text TXT:text BLDAT:date BUDAT:date FAEDN:date BETRW:num WAERS:text STATUS:text AUGBL:text AUGDT:date AUGRD:text RPNUM:text SAMMR:text XBLNR:text') },
  { sheet: 'Billable Items', code: 'DFKKBIX', scope: 'workspace', key: ['BITID'],
    required: ['BITID', 'BITTYPE', 'GPART', 'VKONT', 'BITDATE', 'BITAMOUNT', 'WAERS', 'STATUS'],
    columns: spec('BITID:text BITCLASS:text SUBPROCESS:text BITTYPE:text SRCTATYPE:text SRCTAID:text GPART:text VKONT:text BITDATE:date CRDATE:date BILLFIRST:date BITAMOUNT:num WAERS:text STATUS:text INVDOC:text') },
  { sheet: 'Billing Documents', code: 'DFKKINVBILL', scope: 'workspace', key: ['INVDOC'],
    required: ['INVDOC', 'GPART', 'VKONT', 'BILLEDON', 'AMOUNT', 'WAERS', 'STATUS'],
    columns: spec('INVDOC:text GPART:text VKONT:text LOGSYS:text EXTDOCNO:text EXTRUNREF:text STARTPER:date ENDPER:date BILLEDON:date AMOUNT:num WAERS:text REVERSED:text STATUS:text') },
  { sheet: 'Payment Lots', code: 'DFKKZK', scope: 'workspace', key: ['KEYZ1'], required: ['KEYZ1', 'ITEMS', 'TOTAL', 'WAERS', 'STATUS', 'BUKRS'],
    columns: spec('KEYZ1:text ERDAT:date SEARCHTERM:text ITEMS:int TOTAL:num WAERS:text STATUS:text BUKRS:text HBKID:text') },
  { sheet: 'Payment Lot Items', code: 'DFKKZP', scope: 'workspace', key: ['KEYZ1', 'POSZA'], required: ['KEYZ1', 'POSZA', 'BETRZ', 'WAERS', 'STATUS'],
    columns: spec('KEYZ1:text POSZA:text GPART:text VKONT:text XBLNR:text BETRZ:num WAERS:text VALUT:date STATUS:text CLARIFY:text OPBEL:text') },
  { sheet: 'Bank Statement Items', code: 'FEBEP', scope: 'workspace', key: ['KUKEY', 'ESNUM'],
    required: ['KUKEY', 'ESNUM', 'BUKRS', 'HBKID', 'AZNUM', 'AZDAT', 'WAERS', 'KWBTR', 'SHKZG', 'BANKSTAT', 'SUBSTAT'],
    columns: spec('KUKEY:text ESNUM:text BUKRS:text HBKID:text HKTID:text AZNUM:text AZDAT:date ASTAT:text WAERS:text KWBTR:num SHKZG:text VGINT:text VGEXT:text PARTNER:text NOTE:text BUDAT:date VALUT:date BELNR:text BANKSTAT:text SUBSTAT:text BUNDLE:text') },
];

/** Parent-child relationships checked before anything is written. [child, columns, parent, columns] */
export const RELATIONS = [
  ['CSKS', ['BUKRS'], 'T001', ['BUKRS']],
  ['MARA', ['SAKTO'], 'SKA1', ['SAKNR']],
  ['LFA1', ['BUKRS'], 'T001', ['BUKRS']], ['LFA1', ['AKONT'], 'SKA1', ['SAKNR']],
  ['KNA1', ['BUKRS'], 'T001', ['BUKRS']], ['KNA1', ['AKONT'], 'SKA1', ['SAKNR']],
  ['BSIK', ['BUKRS'], 'T001', ['BUKRS']], ['BSIK', ['LIFNR'], 'LFA1', ['LIFNR']],
  ['BSIK', ['HKONT'], 'SKA1', ['SAKNR']], ['BSIK', ['KOSTL'], 'CSKS', ['KOSTL']],
  ['BSID', ['BUKRS'], 'T001', ['BUKRS']], ['BSID', ['KUNNR'], 'KNA1', ['KUNNR']], ['BSID', ['HKONT'], 'SKA1', ['SAKNR']],
  ['EKPO', ['BUKRS'], 'T001', ['BUKRS']], ['EKPO', ['LIFNR'], 'LFA1', ['LIFNR']], ['EKPO', ['MATNR'], 'MARA', ['MATNR']],
  ['EKPO', ['KOSTL'], 'CSKS', ['KOSTL']], ['EKPO', ['SAKTO'], 'SKA1', ['SAKNR']],
  ['MSEG', ['EBELN', 'EBELP'], 'EKPO', ['EBELN', 'EBELP']],
  ['RBKP', ['BUKRS'], 'T001', ['BUKRS']], ['RBKP', ['LIFNR'], 'LFA1', ['LIFNR']], ['RBKP', ['EBELN', 'EBELP'], 'EKPO', ['EBELN', 'EBELP']],
  ['VIMDP', ['BUKRS'], 'T001', ['BUKRS']], ['VIMDP', ['LIFNR'], 'LFA1', ['LIFNR']],
  ['SWWWIHEAD', ['DOCID'], 'VIMDP', ['DOCID']],
  ['FKKVKP', ['BUKRS'], 'T001', ['BUKRS']], ['FKKVKP', ['GPART'], 'KNA1', ['KUNNR']],
  ['DFKKOP', ['BUKRS'], 'T001', ['BUKRS']], ['DFKKOP', ['VKONT'], 'FKKVKP', ['VKONT']], ['DFKKOP', ['GPART'], 'KNA1', ['KUNNR']],
  ['DFKKBIX', ['VKONT'], 'FKKVKP', ['VKONT']], ['DFKKBIX', ['INVDOC'], 'DFKKINVBILL', ['INVDOC']],
  ['DFKKINVBILL', ['VKONT'], 'FKKVKP', ['VKONT']],
  ['DFKKZK', ['BUKRS'], 'T001', ['BUKRS']],
  ['DFKKZP', ['KEYZ1'], 'DFKKZK', ['KEYZ1']], ['DFKKZP', ['VKONT'], 'FKKVKP', ['VKONT']],
  ['FEBEP', ['BUKRS'], 'T001', ['BUKRS']],
];

/** Patterns for identifiers, mirrored from the database constraints. */
export const PATTERNS = {
  BUKRS: /^[0-9A-Z]{4}$/, SAKNR: /^[0-9]{6,10}$/, LIFNR: /^[0-9A-Z]{1,10}$/, KUNNR: /^[0-9A-Z]{1,10}$/,
  BELNR: /^[0-9]{10}$/, GJAHR: /^[0-9]{4}$/, MJAHR: /^[0-9]{4}$/, EBELN: /^[0-9]{10}$/, EBELP: /^[0-9]{5}$/,
  MBLNR: /^[0-9]{10}$/, ZEILE: /^[0-9]{4}$/, DOCID: /^[0-9]{10}$/, WI_ID: /^[0-9]{12}$/, VKONT: /^[0-9]{12}$/,
  OPBEL: /^[0-9]{12}$/, OPUPK: /^[0-9]{4}$/, BITID: /^BIT[0-9]{8,12}$/, INVDOC: /^[0-9]{12}$/, POSZA: /^[0-9]{4}$/,
  ESNUM: /^[0-9]{5}$/, WAERS: /^[A-Z]{3}$/, WI_CT: /^[0-9]{2}:[0-9]{2}:[0-9]{2}$/,
};
// Per-table overrides (same field name, different format).
export const TABLE_PATTERNS = { VIMDP: { INVDOC: /^[0-9]{10}$/ }, FEBEP: { BELNR: /^[0-9]{10}$/ }, DFKKZP: { OPBEL: /^[0-9]{12}$/ } };

// ---------------------------------------------------------------------------
// Data normalization. The workbook contains wording that must not appear in
// the user interface. These rules are the only changes the importer makes to
// cell values; every change is recorded with its original value.
// ---------------------------------------------------------------------------
export const PROHIBITED = /\b(training|trainee\w*|simulat\w*|demo|practi[cs]e|prototype|mock|clone)\b/i;

export const NORMALIZATIONS = [
  {
    rule: 'company-name-configurable',
    description:
      'Company code names containing prohibited wording are replaced by a neutral, configurable placeholder ' +
      '"Company Code <code> - <city>". Teachers set the real organization name under Organization settings; ' +
      'later imports keep a configured name.',
    applies: (code, col, value) => code === 'T001' && col === 'BUTXT' && PROHIBITED.test(value),
    apply: (value, row) => `Company Code ${row.BUKRS}${row.ORT01 ? ` - ${row.ORT01}` : ''}`,
  },
  {
    rule: 'user-id-neutral',
    description: 'User IDs TRAINEEnn (entered by / agent fields) become ERPUSERnn.',
    applies: (code, col, value) => ['USNAM', 'AGENT', 'WI_AAGENT', 'ERNAM'].includes(col) && /^TRAINEE\d+$/i.test(value),
    apply: (value) => value.toUpperCase().replace(/^TRAINEE/, 'ERPUSER'),
  },
];
