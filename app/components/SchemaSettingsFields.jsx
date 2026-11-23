/**
 * Shipping and returns fields for the schema app embed. Values are read from
 * the DOM with readSchemaSettings (Polaris fields aren't React-controlled).
 */
import { readFields } from "../lib/fields";

export function SchemaSettingsFields({ settings, currency }) {
  return (
    <s-stack direction="block" gap="small">
      <s-switch
        name="shippingEnabled"
        label="Include shipping details"
        checked={settings.shipping.enabled || undefined}
      />
      <s-grid
        gridTemplateColumns="@container (inline-size > 640px) 'repeat(2, minmax(0, 1fr))', 'minmax(0, 1fr)'"
        gap="base"
      >
        <s-number-field
          name="shippingRate"
          label="Shipping rate"
          details="Use 0 for free shipping"
          prefix={currency}
          min={0}
          step={0.01}
          value={String(settings.shipping.rate)}
        />
        <s-text-field
          name="shippingCountries"
          label="Ships to"
          details="Two-letter country codes, separated by commas"
          value={settings.shipping.countries.join(", ")}
        />
      </s-grid>
      <s-grid
        gridTemplateColumns="@container (inline-size > 640px) 'repeat(4, minmax(0, 1fr))', 'repeat(2, minmax(0, 1fr))'"
        gap="base"
      >
        <s-number-field
          name="handlingMin"
          label="Handling, min days"
          min={0}
          value={String(settings.shipping.handlingMin)}
        />
        <s-number-field
          name="handlingMax"
          label="Handling, max days"
          min={0}
          value={String(settings.shipping.handlingMax)}
        />
        <s-number-field
          name="transitMin"
          label="Transit, min days"
          min={0}
          value={String(settings.shipping.transitMin)}
        />
        <s-number-field
          name="transitMax"
          label="Transit, max days"
          min={0}
          value={String(settings.shipping.transitMax)}
        />
      </s-grid>

      <s-switch
        name="returnsAccepted"
        label="Accept returns"
        checked={settings.returns.accepted || undefined}
      />
      <s-grid
        gridTemplateColumns="@container (inline-size > 640px) 'repeat(2, minmax(0, 1fr))', 'minmax(0, 1fr)'"
        gap="base"
      >
        <s-number-field
          name="returnDays"
          label="Return window (days)"
          min={1}
          value={String(settings.returns.days)}
        />
        <s-select
          name="returnFees"
          label="Return shipping"
          value={settings.returns.fees}
        >
          <s-option value="free">Free returns</s-option>
          <s-option value="customer">Customer pays return shipping</s-option>
        </s-select>
      </s-grid>
    </s-stack>
  );
}

/** Collects the fields above into the shape normalizeSchemaSettings expects. */
export function readSchemaSettings(root) {
  const { on, value } = readFields(root);
  return {
    shipping: {
      enabled: on("shippingEnabled"),
      rate: value("shippingRate"),
      countries: value("shippingCountries"),
      handlingMin: value("handlingMin"),
      handlingMax: value("handlingMax"),
      transitMin: value("transitMin"),
      transitMax: value("transitMax"),
    },
    returns: {
      accepted: on("returnsAccepted"),
      days: value("returnDays"),
      fees: value("returnFees"),
    },
  };
}
