// apps/api/src/bookings/bookings.service.ts
// [F-ID: SRC-BOOKINGS-SERVICE-01]
// @version 1.0.0
// @changelog 1.0.0 — Create/list/cancel bookings. Overlap safety is delegated to the DB constraint.

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

// PostgREST's answer when `.single()` matches no row.
const NO_ROW_CODE = 'PGRST116';

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

    // One update, filtered by tenant and by the confirmed status: only a
    // confirmed booking of this tenant can be cancelled, and cancelled is
    // terminal. A booking of another tenant matches no row, exactly like one
    // that does not exist.
    const { data, error } = await supabase
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', bookingId)
      .eq('tenant_id', tenantId)
      .eq('status', 'confirmed')
      .select()
      .single();

    if (!error) {
      return toBooking(data);
    }
    if (error.code !== NO_ROW_CODE) {
      throw error;
    }

    // No row was cancelled. The lookup is filtered by tenant too, so a
    // booking of another tenant is never visible here and answers the same
    // 404 as a missing one; a booking of this tenant in another state is the
    // only case that gets a different answer.
    const { data: existing, error: lookupError } = await supabase
      .from('bookings')
      .select('status')
      .eq('id', bookingId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (lookupError) {
      throw lookupError;
    }
    if (!existing) {
      throw new NotFoundException('Booking not found.');
    }
    throw new ConflictException('Only a confirmed booking can be cancelled.');
  }
}
