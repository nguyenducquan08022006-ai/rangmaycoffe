-- Seed 4 signature Rang May Coffee product lines into store_products

insert into public.store_products (id, sku, name, price, stock_quantity, is_available, badge_text)
values
  (
    'drip-pack-001',
    'RM-DRIP-001',
    'Rang Mây Bản Giao Hưởng',
    119000,
    50,
    true,
    'Best Seller • Cân bằng êm dịu'
  ),
  (
    'drip-pack-002',
    'RM-DRIP-002',
    'Rang Mây Đại Ngàn (Gu Đậm Sữa Đá)',
    109000,
    45,
    true,
    'Đậm đà • Chuyên Sữa đá & Bạc xỉu'
  ),
  (
    'drip-pack-003',
    'RM-DRIP-003',
    'Rang Mây Sương Sớm (100% Arabica)',
    145000,
    35,
    true,
    'Specialty 1.200m • Hợp Cold Brew'
  ),
  (
    'gift-box-004',
    'RM-GIFT-004',
    'Hộp Quà Tinh Hoa Măng Đen (Mix 3 Vị)',
    269000,
    25,
    true,
    'Quà biếu cao cấp • 24 gói đủ 3 vị'
  )
on conflict (id) do update
set
  name = excluded.name,
  badge_text = case
    when public.store_products.badge_text in ('', 'Phin giấy tiện lợi, minh bạch lô sản xuất') then excluded.badge_text
    else public.store_products.badge_text
  end;
