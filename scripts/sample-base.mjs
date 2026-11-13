// Builds the English sample base used for the GitHub screenshots: node scripts/sample-base.mjs OUT.basecraft
// Needs the CLI (npm run build:cli). Replaces OUT when it exists.
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = process.argv[2];
if (!out?.endsWith('.basecraft')) { console.error('usage: node scripts/sample-base.mjs OUT.basecraft'); process.exit(2); }
const cli = path.join(import.meta.dirname, '..', 'out', 'cli', 'basecraft-cli.mjs');

// --- Palette and helpers ---
const C = { espresso: '#3b2a20', roast: '#6f4e37', caramel: '#c8742c', cream: '#f7f1e8', latte: '#e9dccb', white: '#ffffff', ink: '#2b2b2b', muted: '#7a6a5d' };
const cm = (x) => Math.round(x * 567);
const FONT = 'Inter'; // embedded: same metrics on every system, no 'not portable' warning
let seq = 0;
const ctl = (kind, name, left, top, width, height, props = {}, children) => ({ kind, name, left: cm(left), top: cm(top), width: cm(width), height: cm(height), props, ...(children ? { children } : {}) });
const label = (name, left, top, width, caption, extra = {}) => ctl('label', name, left, top, width, 0.6, { Caption: caption, FontName: FONT, FontSize: 10, ForeColor: C.muted, ...extra });
const title = (caption, width, sub) => [
  ctl('label', 'lblTitle', 0.6, 0.35, width - 1.2, 1, { Caption: caption, FontName: FONT, FontSize: 20, FontWeight: 'bold', ForeColor: C.white }),
  ...(sub ? [ctl('label', 'lblSubtitle', 0.6, 1.35, width - 1.2, 0.6, { Caption: sub, FontName: FONT, FontSize: 10, ForeColor: C.latte })] : []),
];
const box = { FontName: FONT, FontSize: 10, ForeColor: C.ink, BackColor: C.white, BorderStyle: 'solid', BorderColor: C.latte };
// A bound text box with its attached label above it.
const field = (src, left, top, width, extra = {}, caption = src.replace(/([a-z])([A-Z])/g, '$1 $2')) =>
  ctl(extra.kind ?? 'textBox', `txt${src}`, left, top + 0.6, width, 0.65, { ControlSource: src, ...box, ...extra.props },
    [label(`lbl${src}`, left, top, width, caption)]);
const button = (name, left, top, width, caption, onClick, color = C.caramel) =>
  ctl('commandButton', name, left, top, width, 1, { Caption: caption, FontName: FONT, FontSize: 11, FontWeight: 'bold', ForeColor: C.white, BackColor: color, BorderStyle: 'transparent', OnClick: onClick });
const run = (...items) => ({ embedded: { formatVersion: '1.0', items } });
const act = (action, args = {}) => ({ k: 'action', action, args });
const header = (h, controls) => ({ kind: 'formHeader', height: cm(h), props: { Visible: true, BackColor: C.espresso }, controls });
const footer = (h, controls = []) => ({ kind: 'formFooter', height: cm(h), props: { Visible: true, BackColor: C.latte }, controls });
const detail = (h, controls, back = C.cream) => ({ kind: 'detail', height: cm(h), props: { BackColor: back }, controls });
const formDoc = (source, width, sections, props = {}) => ({ formatVersion: '1.0', recordSource: source, props: { Width: cm(width), RecordSelectors: false, ...props }, sections });
const table = (name) => ({ kind: 'table', name });
const query = (name) => ({ kind: 'query', name });

// --- Tables ---
const auto = (name) => ({ name, type: 'autoNumber', primaryKey: true });
const text = (name, size = 50, more = {}) => ({ name, type: 'shortText', size, ...more });
const long = (name, more = {}) => ({ name, type: 'number', numberSize: 'longInteger', ...more });
const ops = [
  { op: 'table.create', name: 'Categories', description: 'Coffee and equipment families', fields: [auto('CategoryID'), text('CategoryName', 50, { required: true }), { name: 'Description', type: 'longText' }] },
  { op: 'table.create', name: 'Products', fields: [auto('ProductID'), text('ProductName', 80, { required: true }), long('CategoryID', { required: true }), text('Origin', 40),
    { name: 'UnitPrice', type: 'currency' }, long('UnitsInStock'), { name: 'Discontinued', type: 'yesNo' }] },
  { op: 'table.create', name: 'Customers', fields: [auto('CustomerID'), text('CompanyName', 80, { required: true }), text('ContactName'), text('City', 40), text('Country', 40), text('Phone', 24), text('Email', 80)] },
  { op: 'table.create', name: 'Orders', fields: [auto('OrderID'), long('CustomerID', { required: true }), { name: 'OrderDate', type: 'dateTime', format: 'shortDate', required: true },
    { name: 'ShippedDate', type: 'dateTime', format: 'shortDate' }, text('Status', 20)] },
  { op: 'table.create', name: 'OrderDetails', fields: [auto('OrderDetailID'), long('OrderID', { required: true }), long('ProductID', { required: true }), long('Quantity', { required: true }), { name: 'UnitPrice', type: 'currency' }] },
  { op: 'relation.create', parentTable: 'Categories', parentFields: ['CategoryID'], childTable: 'Products', childFields: ['CategoryID'] },
  { op: 'relation.create', parentTable: 'Customers', parentFields: ['CustomerID'], childTable: 'Orders', childFields: ['CustomerID'] },
  { op: 'relation.create', parentTable: 'Orders', parentFields: ['OrderID'], childTable: 'OrderDetails', childFields: ['OrderID'], cascadeDelete: true },
  { op: 'relation.create', parentTable: 'Products', parentFields: ['ProductID'], childTable: 'OrderDetails', childFields: ['ProductID'] },
];

// --- Data (deterministic) ---
let s = 7;
const rnd = (n) => { s = (s * 1103515245 + 12345) % 2147483648; return (s >>> 12) % n; };
const categories = [
  ['Single Origin', 'Beans from one farm or region, roasted to bring out their character.'],
  ['Blends', 'House blends for espresso and filter.'],
  ['Decaf', 'Swiss Water Process decaffeinated coffees.'],
  ['Equipment', 'Grinders, brewers and accessories.'],
];
const products = [
  ['Ethiopia Yirgacheffe', 1, 'Ethiopia', 14.5], ['Colombia Huila', 1, 'Colombia', 12.9], ['Kenya Nyeri AA', 1, 'Kenya', 16.2], ['Guatemala Antigua', 1, 'Guatemala', 13.4],
  ['Sumatra Mandheling', 1, 'Indonesia', 13.9], ['Harbor Espresso', 2, 'Brazil / Ethiopia', 11.5], ['Morning Fog', 2, 'Colombia / Peru', 10.9], ['Dark Pier', 2, 'Sumatra / Brazil', 11.2],
  ['Decaf Peru', 3, 'Peru', 12.5], ['Decaf Espresso', 3, 'Brazil', 12.0], ['Burr Grinder', 4, '', 89.0], ['Pour-Over Kit', 4, '', 34.5], ['Cold Brew Jar', 4, '', 24.0], ['Gooseneck Kettle', 4, '', 49.9],
];
const customers = [
  ['Blue Door Café', 'Maya Lindqvist', 'Portland', 'USA'], ['Northside Bakery', 'Tom Okafor', 'Seattle', 'USA'], ['The Reading Room', 'Ines Duarte', 'Lisbon', 'Portugal'],
  ['Kettle & Crumb', 'Sam Whitfield', 'Bristol', 'UK'], ['Café Lumen', 'Léa Moreau', 'Lyon', 'France'], ['Driftwood Deli', 'Jonas Berg', 'Oslo', 'Norway'],
  ['Corner Grind', 'Aisha Rahman', 'Toronto', 'Canada'], ['Hilltop Hotel', 'Marco Bellini', 'Turin', 'Italy'], ['Green Fern Co-op', 'Priya Nair', 'Melbourne', 'Australia'],
  ['Station Espresso', 'Daniel Kim', 'Vancouver', 'Canada'], ['Old Mill Books', 'Hannah Weber', 'Munich', 'Germany'], ['Seaside Kiosk', 'Luis Ortega', 'Valencia', 'Spain'],
];
ops.push({ op: 'rows.insert', table: 'Categories', rows: categories.map(([CategoryName, Description]) => ({ CategoryName, Description })) });
ops.push({ op: 'rows.insert', table: 'Products', rows: products.map(([ProductName, CategoryID, Origin, UnitPrice], i) =>
  ({ ProductName, CategoryID, Origin: Origin || null, UnitPrice, UnitsInStock: 20 + rnd(180), Discontinued: i === 7 })) });
ops.push({ op: 'rows.insert', table: 'Customers', rows: customers.map(([CompanyName, ContactName, City, Country], i) =>
  ({ CompanyName, ContactName, City, Country, Phone: `+1 555 01${String(10 + i).padStart(2, '0')}`, Email: `${ContactName.split(' ')[0].toLowerCase()}@${CompanyName.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]+/g, '')}.example` })) });
const orders = [], details = [];
for (let o = 1; o <= 48; o++) {
  const day = new Date(Date.UTC(2026, 0, 3) + (o * 6 + rnd(4)) * 86400000);
  const shipped = o <= 44 ? new Date(day.getTime() + (1 + rnd(4)) * 86400000) : null;
  const iso = (d) => d.toISOString().slice(0, 10);
  orders.push({ CustomerID: 1 + rnd(customers.length), OrderDate: iso(day), ShippedDate: shipped && iso(shipped), Status: shipped ? 'Shipped' : 'Open' });
  const lines = o === 1 ? 4 : 1 + rnd(4), used = new Set();   // the order the form opens on shows several lines
  for (let l = 0; l < lines; l++) {
    const p = rnd(products.length);
    if (used.has(p)) continue;
    used.add(p);
    details.push({ OrderID: o, ProductID: p + 1, Quantity: products[p][1] === 4 ? 1 + rnd(3) : 2 + rnd(20), UnitPrice: products[p][3] });
  }
}
ops.push({ op: 'rows.insert', table: 'Orders', rows: orders }, { op: 'rows.insert', table: 'OrderDetails', rows: details });

// --- Queries ---
ops.push(
  { op: 'query.create', name: 'qryProductList', description: 'Products with their category',
    sql: 'SELECT Categories.CategoryName, Products.ProductName, Products.Origin, Products.UnitPrice, Products.UnitsInStock, Products.Discontinued FROM Categories INNER JOIN Products ON Categories.CategoryID = Products.CategoryID ORDER BY Categories.CategoryName, Products.ProductName' },
  { op: 'query.create', name: 'qryOrderLines', description: 'One row per order line, with its total',
    sql: 'SELECT Orders.OrderID, Orders.OrderDate, Customers.CompanyName, Customers.Country, Categories.CategoryName, Products.ProductName, OrderDetails.Quantity, OrderDetails.UnitPrice, [Quantity]*[OrderDetails].[UnitPrice] AS LineTotal FROM (((Customers INNER JOIN Orders ON Customers.CustomerID = Orders.CustomerID) INNER JOIN OrderDetails ON Orders.OrderID = OrderDetails.OrderID) INNER JOIN Products ON OrderDetails.ProductID = Products.ProductID) INNER JOIN Categories ON Products.CategoryID = Categories.CategoryID' },
  { op: 'query.create', name: 'qrySalesByCategory', description: 'Sales per category',
    sql: 'SELECT qryOrderLines.CategoryName, Sum(qryOrderLines.LineTotal) AS Sales, Count(*) AS Lines FROM qryOrderLines GROUP BY qryOrderLines.CategoryName' },
  { op: 'query.create', name: 'qryOrderDetailsEdit', description: 'Order lines for the order form',
    sql: 'SELECT OrderDetails.OrderDetailID, OrderDetails.OrderID, OrderDetails.ProductID, OrderDetails.Quantity, OrderDetails.UnitPrice, [Quantity]*[UnitPrice] AS LineTotal FROM OrderDetails' },
);

// --- Forms ---
const W = 17;
ops.push({ op: 'form.create', name: 'frmCustomers', layout: 'doc', description: 'Customer card', doc: formDoc(table('Customers'), W, [
  header(2.3, title('Customers', W, 'Cafés, bakeries and shops we roast for')),
  detail(6.2, [
    field('CompanyName', 0.6, 0.5, 9.2, { props: { FontSize: 12, FontWeight: 'bold' } }, 'Company'),
    field('CustomerID', 10.4, 0.5, 2.5, { props: { Locked: true, BackColor: C.latte } }, 'ID'),
    field('ContactName', 0.6, 2, 7.6, {}, 'Contact'),
    field('Phone', 8.8, 2, 4.1),
    field('Email', 0.6, 3.5, 12.3),
    field('City', 0.6, 4.9, 6),
    field('Country', 7.2, 4.9, 5.7),
  ]),
  footer(1.2, [
    button('btnNew', 0.6, 0.1, 3.4, 'New customer', run(act('GoToRecord', { Record: 'new' }))),
    button('btnClose', W - 3.6, 0.1, 3, 'Close', run(act('CloseWindow')), C.roast),
  ]),
])});

ops.push({ op: 'form.create', name: 'frmProducts', layout: 'doc', description: 'Product list', doc: formDoc(table('Products'), W, [
  header(3.1, [...title('Products', W, 'Beans, blends and brewing gear'),
    ...[['Product', 0.6], ['Origin', 6.8], ['Price', 10.4], ['Stock', 12.9], ['Disc.', 15.1]].map(([c, l], i) =>
      ctl('label', `hdr${i}`, l, 2.35, 2.5, 0.6, { Caption: c, FontName: FONT, FontSize: 9, FontWeight: 'bold', ForeColor: C.latte, ...(c === 'Price' || c === 'Stock' ? { TextAlign: 'right', width: 2.3 } : {}) }))]),
  detail(0.85, [
    ctl('textBox', 'txtProductName', 0.6, 0.1, 6, 0.65, { ControlSource: 'ProductName', ...box, FontWeight: 'bold' }),
    ctl('textBox', 'txtOrigin', 6.8, 0.1, 3.4, 0.65, { ControlSource: 'Origin', ...box }),
    ctl('textBox', 'txtUnitPrice', 10.4, 0.1, 2.3, 0.65, { ControlSource: 'UnitPrice', Format: 'currency', TextAlign: 'right', ...box }),
    ctl('textBox', 'txtUnitsInStock', 12.9, 0.1, 2, 0.65, { ControlSource: 'UnitsInStock', TextAlign: 'right', ...box }),
    ctl('checkBox', 'chkDiscontinued', 15.4, 0.2, 0.5, 0.5, { ControlSource: 'Discontinued' }),
  ], C.white),
  footer(1.2, [button('btnClose', W - 3.6, 0.1, 3, 'Close', run(act('CloseWindow')), C.roast)]),
], { DefaultView: 'continuous' })});

ops.push({ op: 'form.create', name: 'sfrOrderLines', layout: 'doc', description: 'Lines of an order (subform)', doc: formDoc(query('qryOrderDetailsEdit'), 14, [
  { kind: 'formHeader', height: cm(0.8), props: { Visible: true, BackColor: C.latte }, controls:
    [['Product', 0.2, 6.8], ['Qty', 7.2, 1.8], ['Unit price', 9.2, 2.2], ['Total', 11.6, 2.2]].map(([c, l, w], i) =>
      ctl('label', `hdr${i}`, l, 0.1, w, 0.6, { Caption: c, FontName: FONT, FontSize: 9, FontWeight: 'bold', ForeColor: C.espresso, ...(i ? { TextAlign: 'right' } : {}) })) },
  detail(0.75, [
    ctl('comboBox', 'cboProductID', 0.2, 0.05, 6.8, 0.65, { ControlSource: 'ProductID', RowSourceType: 'tableQuery', RowSource: 'SELECT ProductID, ProductName FROM Products ORDER BY ProductName', ColumnCount: 2, ColumnWidths: '0;3969', BoundColumn: 1, LimitToList: true, ...box }),
    ctl('textBox', 'txtQuantity', 7.2, 0.05, 1.8, 0.65, { ControlSource: 'Quantity', TextAlign: 'right', ...box }),
    ctl('textBox', 'txtUnitPrice', 9.2, 0.05, 2.2, 0.65, { ControlSource: 'UnitPrice', Format: 'currency', TextAlign: 'right', ...box }),
    ctl('textBox', 'txtLineTotal', 11.6, 0.05, 2.2, 0.65, { ControlSource: 'LineTotal', Format: 'currency', TextAlign: 'right', Locked: true, ...box, BackColor: C.cream, FontWeight: 'bold' }),
  ], C.white),
  // ponytail: no order total here, forms evaluate no aggregates (=Sum gives #Error); the invoice report shows it
], { DefaultView: 'continuous', NavigationButtons: false })});

ops.push({ op: 'form.create', name: 'frmOrders', layout: 'doc', description: 'Orders with their lines', doc: formDoc(table('Orders'), W, [
  header(2.3, title('Orders', W, 'Every order and what it contains')),
  detail(9.6, [
    field('OrderID', 0.6, 0.4, 2.4, { props: { Locked: true, BackColor: C.latte, FontWeight: 'bold' } }, 'Order #'),
    field('CustomerID', 3.4, 0.4, 7, { kind: 'comboBox', props: { RowSourceType: 'tableQuery', RowSource: 'SELECT CustomerID, CompanyName FROM Customers ORDER BY CompanyName', ColumnCount: 2, ColumnWidths: '0;3969', BoundColumn: 1, LimitToList: true } }, 'Customer'),
    field('Status', 10.8, 0.4, 2.8),
    field('OrderDate', 0.6, 1.9, 3.6, { props: { Format: 'mediumDate' } }, 'Ordered'),
    field('ShippedDate', 4.6, 1.9, 3.6, { props: { Format: 'mediumDate' } }, 'Shipped'),
    ctl('subform', 'sfrLines', 0.6, 3.4, 14.4, 5.8, { SourceObject: 'sfrOrderLines', LinkMasterFields: 'OrderID', LinkChildFields: 'OrderID', BorderStyle: 'solid', BorderColor: C.latte }),
  ]),
  footer(1.2, [
    button('btnInvoice', 0.6, 0.1, 3.6, 'Print invoice', run(act('SaveRecord'), act('OpenReport', { ReportName: 'rptInvoice', View: 'preview', WhereCondition: '[OrderID]=[Forms]![frmOrders]![OrderID]' }))),
    button('btnClose', W - 3.6, 0.1, 3, 'Close', run(act('CloseWindow')), C.roast),
  ]),
])});

// --- Reports ---
const RW = 18;
const rLabel = (name, left, top, width, caption, extra = {}) => ctl('label', name, left, top, width, 0.55, { Caption: caption, FontName: FONT, FontSize: 9, FontWeight: 'bold', ForeColor: C.roast, ...extra });
const rBox = (name, src, left, top, width, extra = {}) => ctl('textBox', name, left, top, width, 0.5, { ControlSource: src, FontName: FONT, FontSize: 9.5, ForeColor: C.ink, BorderStyle: 'transparent', BackStyle: 'transparent', ...extra });
const rule = (name, top, color = C.latte, width = RW) => ctl('line', name, 0, top, width, 0, { BorderColor: color, BorderWidth: 1 });
const band = (kind, h, controls, props = {}, groupLevel) => ({ kind, height: cm(h), props, controls, ...(groupLevel === undefined ? {} : { groupLevel }) });
const reportHeader = (caption, sub) => band('reportHeader', 2.4, [
  ctl('rectangle', 'boxBanner', 0, 0, RW, 2, { BackColor: C.espresso, BackStyle: 'normal', BorderStyle: 'transparent' }),
  ctl('label', 'lblTitle', 0.5, 0.3, 12, 0.9, { Caption: caption, FontName: FONT, FontSize: 20, FontWeight: 'bold', ForeColor: C.white }),
  ctl('label', 'lblSub', 0.5, 1.2, 12, 0.55, { Caption: sub, FontName: FONT, FontSize: 9.5, ForeColor: C.latte }),
  ctl('textBox', 'txtToday', RW - 5.5, 0.4, 5, 0.55, { ControlSource: '=Date()', Format: 'longDate', TextAlign: 'right', FontName: FONT, FontSize: 9, ForeColor: C.latte, BorderStyle: 'transparent', BackStyle: 'transparent' }),
]);
const pageFooter = band('pageFooter', 0.9, [
  rule('linFoot', 0.15),
  ctl('label', 'lblBrand', 0, 0.3, 8, 0.5, { Caption: 'Harbor Roasters', FontName: FONT, FontSize: 8, ForeColor: C.muted }),
  rBox('txtPage', '="Page " & [Page] & " of " & [Pages]', RW - 5, 0.3, 5, { TextAlign: 'right', FontSize: 8, ForeColor: C.muted }),
]);
const reportDoc = (source, grouping, sections) => ({ formatVersion: '1.0', recordSource: source, props: { Width: cm(RW), grouping }, sections });

ops.push({ op: 'report.create', name: 'rptProductCatalog', layout: 'doc', description: 'Product catalog grouped by category', doc: reportDoc(query('qryProductList'),
  [{ expression: 'CategoryName', order: 'asc', header: true, footer: true, keepTogether: 'withFirstDetail' }], [
    reportHeader('Product Catalog', 'Coffees and equipment, by category'),
    band('pageHeader', 0.8, [rLabel('hProduct', 0.3, 0.1, 6, 'Product'), rLabel('hOrigin', 6.6, 0.1, 4.5, 'Origin'), rLabel('hPrice', 11.4, 0.1, 2.6, 'Price', { TextAlign: 'right' }),
      rLabel('hStock', 14.2, 0.1, 2, 'In stock', { TextAlign: 'right' }), rLabel('hDisc', 16.4, 0.1, 1.4, 'Disc.', { TextAlign: 'center' }), rule('linHead', 0.7, C.caramel)]),
    band('groupHeader', 1, [ctl('rectangle', 'boxGroup', 0, 0.15, RW, 0.75, { BackColor: C.cream, BackStyle: 'normal', BorderStyle: 'transparent' }),
      rBox('txtCategory', 'CategoryName', 0.3, 0.25, 10, { FontSize: 12, FontWeight: 'bold', ForeColor: C.espresso })], {}, 0),
    band('detail', 0.6, [rBox('txtProduct', 'ProductName', 0.3, 0.05, 6), rBox('txtOrigin', 'Origin', 6.6, 0.05, 4.5, { ForeColor: C.muted }),
      rBox('txtPrice', 'UnitPrice', 11.4, 0.05, 2.6, { Format: 'currency', TextAlign: 'right' }), rBox('txtStock', 'UnitsInStock', 14.2, 0.05, 2, { TextAlign: 'right' }),
      ctl('checkBox', 'chkDisc', 16.8, 0.08, 0.4, 0.4, { ControlSource: 'Discontinued' })]),
    band('groupFooter', 0.8, [rule('linGroup', 0.1), rBox('txtItems', '=Count(*) & " products"', 0.3, 0.2, 6, { FontItalic: true, ForeColor: C.muted })], {}, 0),
    pageFooter,
  ]) });

ops.push({ op: 'report.create', name: 'rptSalesByCustomer', layout: 'doc', description: 'Sales grouped by customer, with totals', doc: reportDoc(query('qryOrderLines'),
  [{ expression: 'CompanyName', order: 'asc', header: true, footer: true, keepTogether: 'withFirstDetail' }, { expression: 'OrderDate', order: 'asc', header: false, footer: false, keepTogether: 'no' }], [
    reportHeader('Sales by Customer', 'Order lines and totals for each customer'),
    band('pageHeader', 0.8, [rLabel('hDate', 0.3, 0.1, 2.6, 'Date'), rLabel('hOrder', 3.1, 0.1, 1.6, 'Order'), rLabel('hProduct', 4.9, 0.1, 6, 'Product'),
      rLabel('hQty', 11.1, 0.1, 1.5, 'Qty', { TextAlign: 'right' }), rLabel('hPrice', 12.8, 0.1, 2.4, 'Unit price', { TextAlign: 'right' }), rLabel('hTotal', 15.4, 0.1, 2.4, 'Total', { TextAlign: 'right' }),
      rule('linHead', 0.7, C.caramel)]),
    band('groupHeader', 1.1, [ctl('rectangle', 'boxGroup', 0, 0.15, RW, 0.8, { BackColor: C.cream, BackStyle: 'normal', BorderStyle: 'transparent' }),
      rBox('txtCompany', 'CompanyName', 0.3, 0.25, 10, { FontSize: 12, FontWeight: 'bold', ForeColor: C.espresso }),
      rBox('txtCountry', 'Country', RW - 5.3, 0.3, 5, { TextAlign: 'right', ForeColor: C.muted })], {}, 0),
    band('detail', 0.55, [rBox('txtDate', 'OrderDate', 0.3, 0.03, 2.6, { Format: 'mediumDate' }), rBox('txtOrder', 'OrderID', 3.1, 0.03, 1.6, { ForeColor: C.muted }),
      rBox('txtProduct', 'ProductName', 4.9, 0.03, 6), rBox('txtQty', 'Quantity', 11.1, 0.03, 1.5, { TextAlign: 'right' }),
      rBox('txtPrice', 'UnitPrice', 12.8, 0.03, 2.4, { Format: 'currency', TextAlign: 'right' }), rBox('txtTotal', 'LineTotal', 15.4, 0.03, 2.4, { Format: 'currency', TextAlign: 'right' })]),
    band('groupFooter', 1, [rule('linSub', 0.1, C.latte), rBox('txtSubLabel', '="Total for " & [CompanyName]', 4.9, 0.25, 10.3, { TextAlign: 'right', FontWeight: 'bold', ForeColor: C.roast }),
      rBox('txtSubTotal', '=Sum([LineTotal])', 15.4, 0.25, 2.4, { Format: 'currency', TextAlign: 'right', FontWeight: 'bold', ForeColor: C.caramel })], {}, 0),
    pageFooter,
    band('reportFooter', 1.4, [ctl('rectangle', 'boxGrand', 0, 0.3, RW, 0.9, { BackColor: C.espresso, BackStyle: 'normal', BorderStyle: 'transparent' }),
      ctl('label', 'lblGrand', 0.5, 0.45, 10, 0.6, { Caption: 'Grand total', FontName: FONT, FontSize: 12, FontWeight: 'bold', ForeColor: C.white }),
      rBox('txtGrand', '=Sum([LineTotal])', RW - 5.4, 0.45, 5, { Format: 'currency', TextAlign: 'right', FontSize: 12, FontWeight: 'bold', ForeColor: C.white })]),
  ]) });

ops.push({ op: 'report.create', name: 'rptInvoice', layout: 'doc', description: 'One invoice per order', doc: reportDoc(query('qryOrderLines'),
  [{ expression: 'OrderID', order: 'asc', header: true, footer: true, keepTogether: 'wholeGroup' }], [
    band('groupHeader', 4.6, [
      ctl('rectangle', 'boxBanner', 0, 0, RW, 2, { BackColor: C.espresso, BackStyle: 'normal', BorderStyle: 'transparent' }),
      ctl('label', 'lblBrand', 0.5, 0.3, 9, 0.9, { Caption: 'Harbor Roasters', FontName: FONT, FontSize: 20, FontWeight: 'bold', ForeColor: C.white }),
      ctl('label', 'lblAddr', 0.5, 1.2, 9, 0.55, { Caption: '12 Wharf Street · Small-batch coffee roasting', FontName: FONT, FontSize: 9, ForeColor: C.latte }),
      rBox('txtInvNo', '="INVOICE #" & Format([OrderID],"00000")', RW - 7.5, 0.5, 7, { TextAlign: 'right', FontSize: 14, FontWeight: 'bold', ForeColor: C.caramel }),
      rLabel('lblBill', 0.5, 2.4, 4, 'BILL TO'), rBox('txtCompany', 'CompanyName', 0.5, 2.95, 9, { FontSize: 12, FontWeight: 'bold' }), rBox('txtCountry', 'Country', 0.5, 3.5, 9, { ForeColor: C.muted }),
      rLabel('lblDate', RW - 5.5, 2.4, 5, 'DATE', { TextAlign: 'right' }), rBox('txtDate', 'OrderDate', RW - 5.5, 2.95, 5, { Format: 'longDate', TextAlign: 'right' }),
      rLabel('hProduct', 0.5, 4.05, 9, 'Item'), rLabel('hQty', 10.2, 4.05, 1.8, 'Qty', { TextAlign: 'right' }), rLabel('hPrice', 12.4, 4.05, 2.6, 'Unit price', { TextAlign: 'right' }),
      rLabel('hTotal', 15.2, 4.05, 2.4, 'Amount', { TextAlign: 'right' }), rule('linHead', 4.55, C.caramel),
    ], { ForceNewPage: 'before' }, 0),
    band('detail', 0.6, [rBox('txtProduct', 'ProductName', 0.5, 0.05, 9), rBox('txtQty', 'Quantity', 10.2, 0.05, 1.8, { TextAlign: 'right' }),
      rBox('txtPrice', 'UnitPrice', 12.4, 0.05, 2.6, { Format: 'currency', TextAlign: 'right' }), rBox('txtTotal', 'LineTotal', 15.2, 0.05, 2.4, { Format: 'currency', TextAlign: 'right' })]),
    band('groupFooter', 2.2, [rule('linFoot', 0.15),
      ctl('rectangle', 'boxTotal', RW - 7, 0.4, 7, 0.9, { BackColor: C.cream, BackStyle: 'normal', BorderStyle: 'transparent' }),
      rLabel('lblTotal', RW - 6.7, 0.55, 3, 'TOTAL DUE', { FontSize: 10 }),
      rBox('txtSum', '=Sum([LineTotal])', RW - 4, 0.55, 3.6, { Format: 'currency', TextAlign: 'right', FontSize: 12, FontWeight: 'bold', ForeColor: C.espresso }),
      ctl('label', 'lblThanks', 0.5, 1.6, 12, 0.5, { Caption: 'Thank you for your order!', FontName: FONT, FontSize: 9, FontItalic: true, ForeColor: C.muted }),
    ], {}, 0),
  ]) });

// --- Startup menu ---
const MW = 18;
const tile = (name, left, top, caption, sub, onClick, color) => [
  button(`btn${name}`, left, top, 5.4, caption, onClick, color),
  ctl('label', `lbl${name}`, left, top + 1.05, 5.4, 0.5, { Caption: sub, FontName: FONT, FontSize: 8.5, ForeColor: C.muted, TextAlign: 'center' }),
];
const open = (form) => run(act('OpenForm', { FormName: form }));
const report = (r) => run(act('OpenReport', { ReportName: r, View: 'preview' }));
ops.push({ op: 'form.create', name: 'frmMainMenu', layout: 'doc', description: 'Startup menu', doc: formDoc(null, MW, [
  header(3, [
    ctl('label', 'lblTitle', 0.8, 0.4, 14, 1.2, { Caption: 'Harbor Roasters', FontName: FONT, FontSize: 26, FontWeight: 'bold', ForeColor: C.white }),
    ctl('label', 'lblSubtitle', 0.8, 1.7, 14, 0.7, { Caption: 'Orders, customers and products — built with BaseCraft', FontName: FONT, FontSize: 11, ForeColor: C.latte }),
  ]),
  detail(12.6, [
    label('lblManage', 0.8, 0.6, 8, 'MANAGE', { FontWeight: 'bold', ForeColor: C.roast }),
    ...tile('Orders', 0.8, 1.3, 'Orders', 'Enter and follow orders', open('frmOrders'), C.caramel),
    ...tile('Customers', 6.3, 1.3, 'Customers', 'Who we roast for', open('frmCustomers'), C.caramel),
    ...tile('Products', 11.8, 1.3, 'Products', 'Beans, blends and gear', open('frmProducts'), C.caramel),
    label('lblReports', 0.8, 3.6, 8, 'REPORTS', { FontWeight: 'bold', ForeColor: C.roast }),
    ...tile('Catalog', 0.8, 4.3, 'Product catalog', 'Grouped by category', report('rptProductCatalog'), C.roast),
    ...tile('Sales', 6.3, 4.3, 'Sales by customer', 'With subtotals', report('rptSalesByCustomer'), C.roast),
    ...tile('Invoices', 11.8, 4.3, 'Invoices', 'One page per order', report('rptInvoice'), C.roast),
    ctl('chart', 'chtSales', 0.8, 6.5, 16.4, 5.6, { ChartType: 'columnClustered', ChartSource: query('qrySalesByCategory'), ChartAxis: ['CategoryName'], ChartValues: [{ field: 'Sales', agg: 'sum' }],
      ChartTitle: 'Sales by category', HasLegend: false, HasAxisTitles: false, ChartBackStyle: 'normal', ChartBackColor: C.white, ChartBorderStyle: 'solid', ChartBorderColor: C.latte,
      ChartSeries: [{ field: 'Sales', name: 'Sales', color: C.caramel }] }),
  ]),
  footer(1.2, [
    ctl('label', 'lblVersion', 0.8, 0.3, 10, 0.6, { Caption: 'Sample database · open the Navigation Pane with F11', FontName: FONT, FontSize: 9, ForeColor: C.muted }),
    button('btnQuit', MW - 3.8, 0.1, 3, 'Exit', run(act('CloseDatabase')), C.espresso),
  ]),
], { NavigationButtons: false, AllowAdditions: false, Caption: 'Harbor Roasters' })});

// --- Build ---
fs.rmSync(out, { force: true });
const spec = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bc-sample-')), 'spec.json');
fs.writeFileSync(spec, JSON.stringify(ops, null, 1));
execFileSync(process.execPath, [cli, 'new', out], { stdio: 'inherit' });
execFileSync(process.execPath, [cli, 'script', spec, out], { stdio: 'inherit' });

// Startup options (Access: File > Options > Current Database): title and Display Form.
const db = new DatabaseSync(out);
const row = db.prepare("SELECT value FROM bc_meta WHERE key = 'options'").get();
const opts = row ? JSON.parse(row.value) : {};
opts.startup = { ...opts.startup, appTitle: 'Harbor Roasters', startupForm: 'frmMainMenu' };
db.prepare("INSERT INTO bc_meta (key, value) VALUES ('options', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(opts));
db.close();
console.log(`${out}: ${ops.length} operations, ${orders.length} orders, ${details.length} lines`);
