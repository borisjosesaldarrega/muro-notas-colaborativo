-- Elimina la ultima politica de almacenamiento del sistema anterior.
drop policy if exists "product_images_public_read" on storage.objects;
