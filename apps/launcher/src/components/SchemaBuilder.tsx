"use client";

import type { FulfillmentField } from "@freeshop/shared";

export function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function fieldsAreValid(fields: FulfillmentField[]): boolean {
  const names = fields.map((f) => f.name);
  return fields.length > 0 && fields.every((f) => f.name && f.label) && new Set(names).size === names.length;
}

/** The fulfillment-form editor shared by the create wizard and the store detail page. */
export function SchemaBuilder({
  fields,
  onChange,
}: {
  fields: FulfillmentField[];
  onChange: (fields: FulfillmentField[]) => void;
}) {
  const update = (i: number, partial: Partial<FulfillmentField>) =>
    onChange(fields.map((f, j) => (j === i ? { ...f, ...partial } : f)));

  return (
    <>
      {fields.map((field, i) => (
        <div className="schema-field" key={i}>
          <div className="field">
            <label className="eyebrow">Label</label>
            <input
              value={field.label}
              onChange={(e) =>
                update(i, {
                  label: e.target.value,
                  name:
                    field.name === slugify(field.label) || field.name === "" ? slugify(e.target.value) : field.name,
                })
              }
              placeholder="Shipping address"
            />
          </div>
          <div className="field">
            <label className="eyebrow">Field key</label>
            <input value={field.name} onChange={(e) => update(i, { name: slugify(e.target.value) })} />
          </div>
          <div className="field">
            <label className="eyebrow">Type</label>
            <select
              value={field.type}
              onChange={(e) => update(i, { type: e.target.value as FulfillmentField["type"] })}
            >
              <option value="text">text</option>
              <option value="email">email</option>
              <option value="textarea">textarea</option>
            </select>
          </div>
          <label className="check" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={field.required}
              onChange={(e) => update(i, { required: e.target.checked })}
            />
            <span className="eyebrow">req</span>
          </label>
          <button
            type="button"
            className="icon-btn"
            title="Remove field"
            onClick={() => onChange(fields.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}

      <button
        type="button"
        className="btn btn--ghost"
        style={{ marginTop: 16 }}
        onClick={() => onChange([...fields, { name: "", label: "", type: "text", required: false }])}
      >
        + Add field
      </button>
      {!fieldsAreValid(fields) && fields.length > 0 && (
        <p className="field__error" style={{ marginTop: 10 }}>
          Every field needs a label and a unique key.
        </p>
      )}
    </>
  );
}
