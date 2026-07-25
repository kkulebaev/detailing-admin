INSERT INTO "masters" ("name", "position", "active", "can_be_master", "can_be_responsible") VALUES
  ('Вячеслав Толстов', 0, true, true, true),
  ('Иван Содель', 1, true, true, true),
  ('Сергей Теплов', 2, true, true, true),
  ('Дмитрий Глотов', 3, true, true, true),
  ('Андрей и ко.', 4, true, true, true)
ON CONFLICT ("name") DO NOTHING;
