// Pure payload builder for POST /addresses — extracted from checkout.tsx so the
// create/update shape is unit-testable without React or the api client. The
// returned object mirrors the PendingPayload shape in src/store/addresses.ts.
//
// Dependency-free on purpose: imports nothing from React or ../api.
import type { PendingPayload } from './store/addresses';

/** The checkout "customer" fields this builder reads (buildCustomer() output). */
export interface AddressCustomer {
  name: string;
  mobile: string;
  address: string;
  landmark?: string;
  city: string;
  pincode: string;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
}

/**
 * Build the exact object checkout.tsx posts to /addresses.
 *
 * Rule: a serverId exists only when selectedId is a real (positive) saved id;
 * a null/negative selectedId means the row is an optimistic temp the server has
 * never seen, so it must go up as a CREATE with id undefined.
 */
export function buildAddressPayload(
  c: AddressCustomer,
  label: string,
  selectedId: number | null | undefined
): PendingPayload {
  const serverId = selectedId != null && selectedId > 0 ? selectedId : undefined;
  return {
    action: serverId ? 'update' : 'create',
    id: serverId,
    label,
    receiver_name: c.name,
    phone: c.mobile,
    house_no: c.address,
    landmark: c.landmark,
    city: c.city,
    district: 'Aurangabad',
    state: 'Bihar',
    pincode: c.pincode,
    latitude: c.deliveryLat,
    longitude: c.deliveryLng,
    full_address: [c.address, c.city, c.pincode].filter(Boolean).join(', '),
  };
}
