// apps/api/src/bookings/bookings.service.ts
// [F-ID: SRC-BOOKINGS-SERVICE-01]
// @version 1.0.0
// @changelog 1.0.0 — Create/list/cancel bookings. Overlap safety is delegated to the DB constraint.

import { Injectable } from '@nestjs/common';
import { getSupabaseAdminClient } from '../common/supabase/supabase.client';
import { CreateBookingDto } from './dto/create-booking.dto';

export interface Booking {
  id: string;
  resourceId: string;
  createdBy: string;
  startsAt: string;
  endsAt: string;
  status: 'confirmed' | 'cancelled';
  createdAt: string;
}

interface BookingRow {
  id: string;
  resource_id: string;
  created_by: string;
  starts_at: string;
  ends_at: string;
  status: 'confirmed' | 'cancelled';
  created_at: string;
}

function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    resourceId: row.resource_id,
    createdBy: row.created_by,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    createdAt: row.created_at,
  };
}

@Injectable()
export class BookingsService {
  async create(
    tenantId: string,
    userId: string,
    dto: CreateBookingDto,
  ): Promise<Booking> {
    const supabase = getSupabaseAdminClient();

    // No application-level "check then insert" for overlap detection:
    // that pattern is inherently racy under concurrent requests. The
    // `no_overlapping_bookings` exclusion constraint in Postgres is the
    // single source of truth here, and a violation surfaces as a 23P01
    // error that AllExceptionsFilter turns into a 409.
    const { data, error } = await supabase
      .from('bookings')
      .insert({
        tenant_id: tenantId,
        resource_id: dto.resourceId,
        created_by: userId,
        starts_at: dto.startsAt,
        ends_at: dto.endsAt,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return toBooking(data);
  }

  async listForTenant(
    tenantId: string,
    resourceId?: string,
  ): Promise<Booking[]> {
    const supabase = getSupabaseAdminClient();
    let query = supabase
      .from('bookings')
      .select()
      .eq('tenant_id', tenantId)
      .order('starts_at', { ascending: true });

    if (resourceId) {
      query = query.eq('resource_id', resourceId);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    return (data ?? []).map(toBooking);
  }

  async cancel(tenantId: string, bookingId: string): Promise<Booking> {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', bookingId)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return toBooking(data);
  }
}
