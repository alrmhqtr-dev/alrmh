-- Thobe orders now go: Taking measurements, Cutting, Sewing, Quality inspection,
-- Ready for pickup, Collected. Shop-only orders keep Confirmed, Packed,
-- Out for delivery, Delivered. Move open thobe orders onto the new flow.

update orders o set stage = 'measured'
 where o.stage = 'confirmed'
   and exists (select 1 from order_items i where i.order_id = o.id and i.kind = 'thobe');

insert into order_events (order_id, stage, note)
select o.id, 'measured', 'moved to the new stages'
  from orders o
 where o.stage = 'measured'
   and exists (select 1 from order_items i where i.order_id = o.id and i.kind = 'thobe')
   and not exists (select 1 from order_events e where e.order_id = o.id and e.stage = 'measured');

update orders o set stage = 'ready'
 where o.stage = 'out_for_delivery'
   and exists (select 1 from order_items i where i.order_id = o.id and i.kind = 'thobe');
