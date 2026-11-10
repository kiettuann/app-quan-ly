-- Migration 0002 — Business tables (Phase 4). Nguồn: DATABASE_SCHEMA.md §3–§8.
-- Mọi bảng nghiệp vụ có tenant_id bắt buộc. Tiền integer VND, thời gian TEXT ISO 8601 UTC.
-- Không sửa migration 0001. Seed hệ thống dùng INSERT OR IGNORE (chạy lại an toàn).
PRAGMA foreign_keys = ON;

-- ---------- Customers ----------
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  branch_id TEXT REFERENCES branches(id),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  dob TEXT,
  gender TEXT,
  notes TEXT,
  total_spent_vnd INTEGER NOT NULL DEFAULT 0,
  total_visits INTEGER NOT NULL DEFAULT 0,
  last_visit_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS customers_tenant_phone_idx ON customers(tenant_id, phone);
CREATE INDEX IF NOT EXISTS customers_tenant_name_idx ON customers(tenant_id, full_name);

CREATE TABLE IF NOT EXISTS customer_auth_methods (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  type TEXT NOT NULL DEFAULT 'otp_phone',
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_auth_methods_unique ON customer_auth_methods(customer_id, phone);

CREATE TABLE IF NOT EXISTS customer_otp_challenges (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  resend_after TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_otp_phone_idx ON customer_otp_challenges(phone, expires_at);

-- Staff Email OTP login + password reset (Phase 4 Auth).
CREATE TABLE IF NOT EXISTS email_otp_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login',
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  resend_after TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_otp_email_idx ON email_otp_challenges(email, expires_at);

CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id, expires_at);

-- ---------- Services / Booking ----------
CREATE TABLE IF NOT EXISTS service_categories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS service_categories_tenant_name_unique ON service_categories(tenant_id, name);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  category_id TEXT REFERENCES service_categories(id),
  name TEXT NOT NULL,
  description TEXT,
  price_vnd INTEGER NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'active',
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS services_tenant_status_idx ON services(tenant_id, status);

CREATE TABLE IF NOT EXISTS service_branch_settings (
  service_id TEXT NOT NULL REFERENCES services(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  price_vnd INTEGER,
  is_available INTEGER NOT NULL DEFAULT 1,
  technician_ids_json TEXT,
  PRIMARY KEY (service_id, branch_id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  technician_id TEXT REFERENCES employees(id),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'internal',
  deposit_vnd INTEGER NOT NULL DEFAULT 0,
  deposit_status TEXT NOT NULL DEFAULT 'none',
  total_price_vnd INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bookings_tenant_branch_start_idx ON bookings(tenant_id, branch_id, start_at);
CREATE INDEX IF NOT EXISTS bookings_technician_start_idx ON bookings(technician_id, start_at);
CREATE INDEX IF NOT EXISTS bookings_customer_idx ON bookings(tenant_id, customer_id);

CREATE TABLE IF NOT EXISTS booking_items (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  service_name_snapshot TEXT NOT NULL,
  price_vnd_snapshot INTEGER NOT NULL,
  duration_minutes_snapshot INTEGER NOT NULL,
  technician_id TEXT REFERENCES employees(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS booking_items_booking_idx ON booking_items(booking_id);

CREATE TABLE IF NOT EXISTS booking_status_history (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  changed_by TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS booking_status_history_booking_idx ON booking_status_history(booking_id, created_at);

CREATE TABLE IF NOT EXISTS working_hours (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  weekday INTEGER NOT NULL,
  open_time TEXT NOT NULL,
  close_time TEXT NOT NULL,
  is_closed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS working_hours_branch_weekday_unique ON working_hours(branch_id, weekday);

CREATE TABLE IF NOT EXISTS technician_availability (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  technician_id TEXT NOT NULL REFERENCES employees(id),
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  is_off INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS technician_availability_idx ON technician_availability(technician_id, date);

CREATE TABLE IF NOT EXISTS staff_shifts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS staff_shifts_employee_date_idx ON staff_shifts(employee_id, date);

-- ---------- POS ----------
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  booking_id TEXT REFERENCES bookings(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  invoice_no TEXT NOT NULL,
  subtotal_vnd INTEGER NOT NULL DEFAULT 0,
  discount_vnd INTEGER NOT NULL DEFAULT 0,
  surcharge_vnd INTEGER NOT NULL DEFAULT 0,
  total_vnd INTEGER NOT NULL DEFAULT 0,
  paid_vnd INTEGER NOT NULL DEFAULT 0,
  refunded_vnd INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_tenant_no_unique ON invoices(tenant_id, invoice_no);
CREATE INDEX IF NOT EXISTS invoices_tenant_created_idx ON invoices(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  item_type TEXT NOT NULL,
  ref_id TEXT,
  name_snapshot TEXT NOT NULL,
  unit_price_vnd_snapshot INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  technician_id TEXT REFERENCES employees(id),
  seller_id TEXT REFERENCES employees(id),
  line_total_vnd INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx ON invoice_items(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  amount_vnd INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  received_by TEXT,
  paid_at TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments(invoice_id);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  amount_vnd INTEGER NOT NULL,
  reason TEXT,
  refunded_by TEXT,
  refunded_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS refunds_invoice_idx ON refunds(invoice_id);

CREATE TABLE IF NOT EXISTS discounts (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  type TEXT NOT NULL,
  value INTEGER NOT NULL,
  reason TEXT,
  applied_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS discounts_invoice_idx ON discounts(invoice_id);

-- ---------- HR & Commission ----------
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT REFERENCES users(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  full_name TEXT NOT NULL,
  phone TEXT,
  position TEXT,
  hire_date TEXT,
  base_salary_vnd INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS employees_tenant_branch_idx ON employees(tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS employee_profiles (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id),
  skills_json TEXT NOT NULL DEFAULT '[]',
  bio TEXT,
  avatar_r2_key TEXT
);

CREATE TABLE IF NOT EXISTS commission_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_ref_id TEXT,
  rate_type TEXT NOT NULL,
  rate_value INTEGER NOT NULL,
  min_sales_vnd INTEGER,
  max_amount_vnd INTEGER,
  priority INTEGER NOT NULL DEFAULT 10,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS commission_rules_tenant_scope_idx ON commission_rules(tenant_id, scope_type, status);

CREATE TABLE IF NOT EXISTS commission_rule_versions (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES commission_rules(id),
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS commission_rule_versions_unique ON commission_rule_versions(rule_id, version);

CREATE TABLE IF NOT EXISTS commission_calculations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  rule_version_id TEXT NOT NULL REFERENCES commission_rule_versions(id),
  base_amount_vnd INTEGER NOT NULL,
  commission_vnd INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  period TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS commission_calc_invoice_idx ON commission_calculations(invoice_id);
CREATE INDEX IF NOT EXISTS commission_calc_employee_period_idx ON commission_calculations(employee_id, period, status);

CREATE TABLE IF NOT EXISTS commission_items (
  id TEXT PRIMARY KEY,
  calculation_id TEXT NOT NULL REFERENCES commission_calculations(id),
  invoice_item_id TEXT NOT NULL REFERENCES invoice_items(id),
  rule_id TEXT NOT NULL REFERENCES commission_rules(id),
  amount_vnd INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS commission_items_calc_idx ON commission_items(calculation_id);

CREATE TABLE IF NOT EXISTS payroll_periods (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  branch_id TEXT REFERENCES branches(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_periods_unique ON payroll_periods(tenant_id, branch_id, period_start);

CREATE TABLE IF NOT EXISTS payrolls (
  id TEXT PRIMARY KEY,
  payroll_period_id TEXT NOT NULL REFERENCES payroll_periods(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  base_salary_vnd INTEGER NOT NULL DEFAULT 0,
  commission_vnd INTEGER NOT NULL DEFAULT 0,
  bonus_vnd INTEGER NOT NULL DEFAULT 0,
  allowance_vnd INTEGER NOT NULL DEFAULT 0,
  deduction_vnd INTEGER NOT NULL DEFAULT 0,
  advance_vnd INTEGER NOT NULL DEFAULT 0,
  net_vnd INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  paid_at TEXT,
  confirmed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payrolls_period_idx ON payrolls(payroll_period_id);

CREATE TABLE IF NOT EXISTS payroll_items (
  id TEXT PRIMARY KEY,
  payroll_id TEXT NOT NULL REFERENCES payrolls(id),
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  amount_vnd INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payroll_items_payroll_idx ON payroll_items(payroll_id);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  date TEXT NOT NULL,
  check_in_at TEXT,
  check_out_at TEXT,
  status TEXT NOT NULL DEFAULT 'present',
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_employee_date_unique ON attendance_records(employee_id, date);

-- ---------- Inventory ----------
CREATE TABLE IF NOT EXISTS product_categories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS product_categories_tenant_name_unique ON product_categories(tenant_id, name);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  category_id TEXT REFERENCES product_categories(id),
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'cái',
  cost_price_vnd INTEGER NOT NULL DEFAULT 0,
  sell_price_vnd INTEGER NOT NULL DEFAULT 0,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_sku_unique ON products(tenant_id, sku);
CREATE INDEX IF NOT EXISTS products_tenant_name_idx ON products(tenant_id, name);

CREATE TABLE IF NOT EXISTS inventory_locations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  location_id TEXT REFERENCES inventory_locations(id),
  type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON stock_movements(product_id, created_at);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'draft',
  total_cost_vnd INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS purchase_orders_tenant_idx ON purchase_orders(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_cost_vnd INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS purchase_order_items_po_idx ON purchase_order_items(purchase_order_id);

-- ---------- Expenses ----------
CREATE TABLE IF NOT EXISTS expense_categories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_tenant_name_unique ON expense_categories(tenant_id, name);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  category_id TEXT REFERENCES expense_categories(id),
  amount_vnd INTEGER NOT NULL,
  expense_date TEXT NOT NULL,
  description TEXT,
  receipt_r2_key TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS expenses_tenant_branch_date_idx ON expenses(tenant_id, branch_id, expense_date);

-- ---------- Seed hệ thống (INSERT OR IGNORE — chạy lại an toàn) ----------
-- Permissions: id = perm_<key> (xem PERMISSIONS.md, packages/shared/src/permissions.ts).
INSERT OR IGNORE INTO permissions (id, key, module, description) VALUES
('perm_tenant.manage','tenant.manage','tenant','Quản lý tenant'),
('perm_branch.manage','branch.manage','branch','Tạo/sửa/xóa chi nhánh'),
('perm_branch.view','branch.view','branch','Xem chi nhánh'),
('perm_user.invite','user.invite','user','Mời user, gán role'),
('perm_role.manage','role.manage','role','Sửa role / quyền'),
('perm_booking.view','booking.view','booking','Xem booking'),
('perm_booking.create','booking.create','booking','Tạo booking nội bộ'),
('perm_booking.update','booking.update','booking','Sửa giờ / đổi KTV / hủy booking'),
('perm_booking.status','booking.status','booking','Đổi trạng thái booking'),
('perm_invoice.create','invoice.create','invoice','Tạo hóa đơn, thu tiền'),
('perm_invoice.refund','invoice.refund','invoice','Hoàn tiền / hủy / điều chỉnh hóa đơn'),
('perm_revenue.view','revenue.view','report','Xem doanh thu toàn tổ chức'),
('perm_customer.view','customer.view','customer','Xem khách hàng'),
('perm_customer.manage','customer.manage','customer','Tạo/sửa khách hàng'),
('perm_service.manage','service.manage','service','Quản lý dịch vụ / giá'),
('perm_employee.manage','employee.manage','employee','Quản lý nhân viên, ca làm'),
('perm_attendance.manage','attendance.manage','attendance','Chấm công'),
('perm_payroll.view','payroll.view','payroll','Xem lương/hoa hồng'),
('perm_payroll.manage','payroll.manage','payroll','Chốt kỳ lương / xác nhận thanh toán'),
('perm_commission.manage','commission.manage','commission','Quản lý commission rules'),
('perm_commission.simulate','commission.simulate','commission','Chạy simulator hoa hồng'),
('perm_inventory.manage','inventory.manage','inventory','Quản lý kho, nhập/xuất'),
('perm_expense.manage','expense.manage','expense','Quản lý chi phí'),
('perm_report.view','report.view','report','Xem báo cáo lãi/lỗ'),
('perm_admin.tenants','admin.tenants','admin','Quản lý tenants (Platform Admin)'),
('perm_admin.plans','admin.plans','admin','Quản lý plans / subscriptions'),
('perm_admin.audit','admin.audit','admin','Xem audit log nền tảng');

-- System roles: id cố định, dùng trong workers/api/src/roles.ts.
INSERT OR IGNORE INTO roles (id, tenant_id, name, description, is_system, created_at, updated_at) VALUES
('role_platform_admin', NULL, 'platform_admin', 'Quản trị nền tảng quanly.store', 1, '2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z'),
('role_tenant_owner', NULL, 'tenant_owner', 'Chủ tiệm', 1, '2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z'),
('role_branch_manager', NULL, 'branch_manager', 'Quản lý chi nhánh', 1, '2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z'),
('role_receptionist', NULL, 'receptionist', 'Lễ tân', 1, '2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z'),
('role_technician', NULL, 'technician', 'Kỹ thuật viên', 1, '2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z'),
('role_customer', NULL, 'customer', 'Khách hàng', 1, '2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z');

-- Gói mặc định cho tenant mới đăng ký.
INSERT OR IGNORE INTO plans (id, name, price_monthly_vnd, max_branches, max_users, max_bookings_month, features_json, status, created_at, updated_at) VALUES
('plan_basic', 'Cơ bản', 0, 3, 10, 500, '{"booking":true,"pos":true,"commission":true,"reports":true}', 'active', '2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z');
