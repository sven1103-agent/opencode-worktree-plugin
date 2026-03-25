import assert from "node:assert/strict";

function resolveRef(rootSchema, ref) {
  if (!ref.startsWith("#/$defs/")) {
    throw new Error(`Unsupported schema ref: ${ref}`);
  }

  const defName = ref.slice("#/$defs/".length);
  return rootSchema.$defs?.[defName];
}

function assertSchemaType(value, expectedTypes, context) {
  const actualType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const allowedTypes = Array.isArray(expectedTypes) ? expectedTypes : [expectedTypes];
  assert.ok(
    allowedTypes.includes(actualType),
    `${context} expected type ${allowedTypes.join("|")}, received ${actualType}`,
  );
}

function validateSchema(value, schema, rootSchema, context) {
  if (schema.$ref) {
    const resolved = resolveRef(rootSchema, schema.$ref);
    assert.ok(resolved, `${context} could not resolve ${schema.$ref}`);
    validateSchema(value, resolved, rootSchema, context);
    return;
  }

  if (schema.allOf) {
    for (const [index, part] of schema.allOf.entries()) {
      validateSchema(value, part, rootSchema, `${context}.allOf[${index}]`);
    }
  }

  if (schema.type) {
    assertSchemaType(value, schema.type, context);
  }

  if (schema.const !== undefined) {
    assert.deepEqual(value, schema.const, `${context} expected const ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum) {
    assert.ok(schema.enum.some((candidate) => Object.is(candidate, value)), `${context} expected one of ${schema.enum.join(", ")}`);
  }

  if (schema.type === "string" && schema.minLength !== undefined) {
    assert.ok(value.length >= schema.minLength, `${context} expected minimum length ${schema.minLength}`);
  }

  if ((schema.type === "object" || (Array.isArray(schema.type) && schema.type.includes("object"))) && value !== null) {
    const properties = schema.properties ?? {};
    const required = schema.required ?? [];

    for (const key of required) {
      assert.ok(Object.hasOwn(value, key), `${context} missing required property ${key}`);
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        assert.ok(Object.hasOwn(properties, key), `${context} has unexpected property ${key}`);
      }
    }

    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) {
        validateSchema(value[key], propertySchema, rootSchema, `${context}.${key}`);
      }
    }
  }

  if ((schema.type === "array" || (Array.isArray(schema.type) && schema.type.includes("array"))) && Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      validateSchema(item, schema.items, rootSchema, `${context}[${index}]`);
    }
  }
}

function assertMatchesSchema(value, schema, label = "value") {
  validateSchema(value, schema, schema, label);
}

export { assertMatchesSchema };
