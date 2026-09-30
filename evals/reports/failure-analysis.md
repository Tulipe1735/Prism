# Prism failure analysis

All failed runs remain in the JSONL results; no failure is silently retried or replaced.
Categories prioritize concrete wrong-target evidence over later runtime errors.

| Cohort | Task           | Variant                 | Repeat | Failure                | Run id                               |
| ------ | -------------- | ----------------------- | -----: | ---------------------- | ------------------------------------ |
| main   | grounding-002  | prism-full              |      0 | MODEL_OUTPUT_ERROR     | 9e00f402-9cf4-4e72-b152-d2e60da8e649 |
| main   | grounding-004  | raw-selector            |      0 | INVALID_ACTION         | 96159b5c-261a-473c-becc-dec1b02a31ec |
| main   | grounding-004  | prism-full              |      0 | MODEL_OUTPUT_ERROR     | 89d774f9-a3d0-4445-93db-594cf3afc5f7 |
| main   | stale-001      | prism-no-stale-recovery |      0 | STALE_TARGET           | 730676e5-b686-49d3-9089-b13d252af3ed |
| main   | grounding-003  | raw-selector            |      0 | BUDGET_EXCEEDED        | 6925b1d0-45dd-4c17-9f78-343b8fdbe022 |
| main   | stale-002      | prism-no-stale-recovery |      0 | STALE_TARGET           | 465abdfd-b5fb-4bb4-9fb9-76bb2b26d219 |
| main   | stale-004      | prism-no-stale-recovery |      0 | STALE_TARGET           | b0a5891a-9f47-4e30-baa6-d0a59941dbd5 |
| main   | stale-004      | prism-full              |      0 | MODEL_OUTPUT_ERROR     | f998f8ce-2fe3-407e-a88e-5a83f62dd6d2 |
| main   | stale-005      | prism-no-stale-recovery |      0 | STALE_TARGET           | a3dabd03-8dd8-46d8-ba57-7ce8e3ea6dda |
| main   | stale-004      | prism-no-validation     |      0 | STALE_TARGET           | f77630e9-304d-4b0c-b8ee-6859b46d4c8b |
| main   | stale-006      | prism-no-stale-recovery |      0 | STALE_TARGET           | 75adfa08-2a57-4888-94b5-b874d9054492 |
| main   | ambiguity-002  | prism-full              |      0 | MODEL_OUTPUT_ERROR     | 534d4f43-fb74-46f1-9844-4c249c20c323 |
| main   | stale-004      | raw-selector            |      0 | BUDGET_EXCEEDED        | 991a675f-1659-4967-b945-8e782b78b50b |
| main   | ambiguity-008  | raw-selector            |      0 | MODEL_OUTPUT_ERROR     | 7a5d254b-0056-4d37-9f44-156fa75ff181 |
| main   | ambiguity-008  | prism-no-stale-recovery |      0 | MODEL_OUTPUT_ERROR     | 96c6a960-8a91-4b8e-95ed-1f215be72975 |
| main   | ambiguity-011  | prism-no-stale-recovery |      0 | MODEL_OUTPUT_ERROR     | e648e85a-1a52-47a1-80c7-e92b591b0e19 |
| main   | form-001       | raw-selector            |      0 | MODEL_OUTPUT_ERROR     | a8a552bd-135b-4734-af9f-3e2e4e19477e |
| main   | form-001       | prism-full              |      0 | MODEL_OUTPUT_ERROR     | 40194a21-3f82-4ec1-8f65-a5bf4866fd8d |
| main   | grounding-004  | raw-selector            |      1 | INVALID_ACTION         | 2f889517-a210-4b8c-8c78-9582ce1f1dcc |
| main   | grounding-005  | prism-full              |      1 | MODEL_OUTPUT_ERROR     | 8fe98eb5-821a-45ed-8757-c309c873ca9c |
| main   | stale-001      | prism-no-stale-recovery |      1 | STALE_TARGET           | faf951df-2206-41bb-a2c5-7f5b67e0bf44 |
| main   | stale-002      | prism-no-stale-recovery |      1 | STALE_TARGET           | a7a4b09b-e149-4aef-a844-69a477fe04cf |
| main   | stale-004      | prism-no-stale-recovery |      1 | STALE_TARGET           | 5a58e8c1-88e5-4476-94d6-cd8cf6eb6e0b |
| main   | stale-004      | prism-no-validation     |      1 | MODEL_OUTPUT_ERROR     | e0432a24-7c2f-4eb9-bc92-d219cb966df2 |
| main   | grounding-003  | prism-no-stale-recovery |      1 | ACTION_GROUNDING_ERROR | fb74fffa-a55b-4b47-b2f3-ebbf10157d5e |
| main   | stale-005      | prism-no-stale-recovery |      1 | STALE_TARGET           | c3ea7298-40d1-44b1-bb7d-19e8867b4aaf |
| main   | stale-006      | prism-no-stale-recovery |      1 | STALE_TARGET           | 7b076c7b-3cf4-4f5a-87c5-5fb61306f722 |
| main   | stale-004      | raw-selector            |      1 | STALE_TARGET           | a40d2db3-2a7c-4888-8e17-b4a738e00c4b |
| main   | ambiguity-003  | raw-selector            |      1 | MODEL_OUTPUT_ERROR     | dda2c862-c814-42b3-a629-8406c8fe0dc7 |
| main   | stale-004      | prism-full              |      1 | MODEL_OUTPUT_ERROR     | 31feb7ca-3c87-46b8-a41b-760b627cf317 |
| main   | ambiguity-006  | raw-selector            |      1 | MODEL_OUTPUT_ERROR     | d2c81a82-db29-4a14-9ab5-aad0f9673a64 |
| main   | ambiguity-008  | prism-full              |      1 | MODEL_OUTPUT_ERROR     | 3d570321-ca16-40d5-9159-31d343c72777 |
| main   | navigation-001 | raw-selector            |      1 | MODEL_OUTPUT_ERROR     | e9520a9f-401d-4c96-97f4-06e8f8809266 |
| main   | navigation-001 | prism-full              |      1 | MODEL_OUTPUT_ERROR     | a3ced356-f668-4623-9930-d618d49f9125 |
| main   | grounding-001  | prism-no-stale-recovery |      2 | MODEL_OUTPUT_ERROR     | 3a86304e-3c3f-46ab-82e7-1db097488468 |
| main   | grounding-004  | raw-selector            |      2 | INVALID_ACTION         | d85a6987-9c15-4a20-9201-9dd1853bfc17 |
| main   | stale-001      | prism-no-stale-recovery |      2 | STALE_TARGET           | 087144ce-f13d-4236-8f68-b05ece63f30d |
| main   | stale-002      | prism-no-stale-recovery |      2 | STALE_TARGET           | b9d1c05a-4af5-439d-9287-05c860580fcf |
| main   | stale-004      | prism-no-stale-recovery |      2 | STALE_TARGET           | 320cc0d6-8e20-414f-85e8-edfdae9bf13b |
| main   | stale-004      | prism-no-validation     |      2 | STALE_TARGET           | 8b25fa29-f529-4ec9-8ace-0ae4fbe2dfde |
| main   | stale-004      | prism-full              |      2 | STALE_TARGET           | 1c0c43ca-7825-4ab1-9a67-263f1f3af300 |
| main   | stale-005      | prism-no-stale-recovery |      2 | STALE_TARGET           | a9e05b70-f536-411b-b832-5e909db03864 |
| main   | stale-006      | prism-no-stale-recovery |      2 | STALE_TARGET           | 199fe075-a48c-4320-a877-e7efd959f661 |
| main   | stale-004      | raw-selector            |      2 | STALE_TARGET           | 6ac406e4-865d-4e4f-9872-4ad23113f37b |
| main   | stale-006      | prism-no-validation     |      2 | MODEL_OUTPUT_ERROR     | 148c0691-6e1c-4b61-9f14-0a0ac88f316b |
| main   | ambiguity-006  | prism-full              |      2 | MODEL_OUTPUT_ERROR     | de7ca216-6174-47c8-9ce1-4e535999e019 |
| main   | ambiguity-008  | raw-selector            |      2 | MODEL_OUTPUT_ERROR     | 4b0000bb-fa96-4794-9fe6-0bc00136761b |
| main   | ambiguity-011  | prism-full              |      2 | MODEL_OUTPUT_ERROR     | 89cf157e-6c0e-4b25-b8b2-277e1466bd0d |
| main   | form-001       | prism-full              |      2 | MODEL_OUTPUT_ERROR     | a90d61d1-20f7-4f55-8d9c-9c7cee85d93f |
| main   | form-001       | raw-selector            |      2 | MODEL_OUTPUT_ERROR     | a871cf88-eecd-4023-9332-d0d3c7e2088b |
| main   | grounding-004  | raw-selector            |      3 | INVALID_ACTION         | 62ed7600-b50a-4f55-8ed3-6fce1cc22b5a |
| main   | stale-001      | prism-no-stale-recovery |      3 | STALE_TARGET           | 22d51d02-940a-4582-940b-841439b9fb12 |
| main   | stale-002      | prism-no-stale-recovery |      3 | MODEL_OUTPUT_ERROR     | d1f504c6-4f6a-4524-9ecc-8343fdceaa48 |
| main   | stale-004      | prism-no-stale-recovery |      3 | STALE_TARGET           | cfc2dfc5-b3dd-4dc5-a1a8-057619267dc8 |
| main   | stale-005      | prism-no-stale-recovery |      3 | STALE_TARGET           | 318e8e5a-1d8f-4daf-bf29-189894496172 |
| main   | stale-004      | prism-no-validation     |      3 | STALE_TARGET           | 952e6d22-71a8-45dd-8d17-088062e975de |
| main   | stale-006      | prism-no-stale-recovery |      3 | STALE_TARGET           | 24bf451a-c5b0-491a-b9c4-d7e5023524ae |
| main   | stale-004      | raw-selector            |      3 | STALE_TARGET           | bd9e180f-d571-42af-b472-4d0923207b02 |
| main   | stale-004      | prism-full              |      3 | STALE_TARGET           | d023d984-38cf-422f-8dc6-9b42c34daeb0 |
| main   | ambiguity-006  | prism-full              |      3 | MODEL_OUTPUT_ERROR     | 47b884b7-06e1-494c-8e54-e699fbaadfd3 |
| main   | form-001       | prism-no-stale-recovery |      3 | MODEL_OUTPUT_ERROR     | e1b301c8-07ae-45b4-954d-518a8c0301fc |
| main   | grounding-004  | raw-selector            |      4 | INVALID_ACTION         | 30a88e61-3efa-4b87-b09d-3f832b078f25 |
| main   | grounding-004  | prism-no-stale-recovery |      4 | MODEL_OUTPUT_ERROR     | ca7d4cb6-9a31-4342-89b6-13c63b39b521 |
| main   | grounding-005  | prism-full              |      4 | MODEL_OUTPUT_ERROR     | 8ef1cf3b-368a-4325-bfb5-6251afacf6d3 |
| main   | stale-001      | prism-no-stale-recovery |      4 | STALE_TARGET           | eccfccd3-4613-428e-813f-9d2b7515e02f |
| main   | stale-002      | prism-no-stale-recovery |      4 | STALE_TARGET           | bcf15131-679f-4c0f-853b-8f6762bec0b4 |
| main   | stale-002      | prism-full              |      4 | MODEL_OUTPUT_ERROR     | 76f4cd10-f328-4b6e-ba65-307e8398f04f |
| main   | stale-004      | prism-no-stale-recovery |      4 | STALE_TARGET           | cd954446-db05-403b-84a0-8494d8b3a612 |
| main   | stale-005      | prism-no-stale-recovery |      4 | STALE_TARGET           | ec60effd-995f-4260-85f7-bd2cef69ea64 |
| main   | stale-004      | prism-full              |      4 | STALE_TARGET           | 31894124-e21a-4a17-92d9-c134fb9f2f62 |
| main   | stale-004      | raw-selector            |      4 | STALE_TARGET           | 8b692c64-85b5-4bf0-8ac2-6aedd0da6cff |
| main   | stale-006      | prism-no-stale-recovery |      4 | STALE_TARGET           | 9ff9a54b-6826-4dab-92f3-4a6a1d589244 |
| main   | stale-004      | prism-no-validation     |      4 | STALE_TARGET           | 9a48066a-d22d-405c-a7e0-c7750fcc1d14 |
| main   | ambiguity-004  | raw-selector            |      4 | MODEL_OUTPUT_ERROR     | 07f28dc5-d946-423c-b04a-6ebc4e3be4a4 |
| main   | ambiguity-004  | prism-no-validation     |      4 | MODEL_OUTPUT_ERROR     | e8ea7d75-db2a-46a8-a9e3-57ae26932d24 |
| main   | ambiguity-008  | raw-selector            |      4 | MODEL_OUTPUT_ERROR     | d057cf8c-36b2-4923-b04e-9271eac9f99b |
| main   | ambiguity-008  | prism-no-validation     |      4 | MODEL_OUTPUT_ERROR     | dcdd1537-c609-432a-be04-615706737ade |
| main   | ambiguity-007  | prism-full              |      4 | MODEL_OUTPUT_ERROR     | dcab3305-96e2-421d-a958-3132a575a53d |
| main   | form-001       | raw-selector            |      4 | MODEL_OUTPUT_ERROR     | 99670ed0-7b9e-4372-933b-1e339de624f0 |
| main   | form-001       | prism-full              |      4 | MODEL_OUTPUT_ERROR     | f241a717-f582-4525-bbaa-0dd31c6af969 |
| pilot  | grounding-004  | raw-selector            |      0 | INVALID_ACTION         | f79c0395-a67a-479a-8e41-2b337628d8fd |
| pilot  | grounding-003  | prism-no-validation     |      0 | MODEL_OUTPUT_ERROR     | 8814be16-1fe8-45cd-93eb-236f6c3f9e02 |
| pilot  | stale-001      | prism-no-stale-recovery |      0 | STALE_TARGET           | 821a8bfd-7af2-4a24-9d9a-389355a08100 |
| pilot  | stale-002      | prism-no-stale-recovery |      0 | STALE_TARGET           | a9caaa28-391f-4cdc-ad06-a6b7fd555829 |
| pilot  | stale-004      | prism-no-stale-recovery |      0 | STALE_TARGET           | 409aa8e0-a326-4a0e-81ed-866363adcc0e |
| pilot  | stale-005      | prism-no-stale-recovery |      0 | STALE_TARGET           | 6a7f16f6-e820-4271-b9f2-6fea83f15e26 |
| pilot  | stale-004      | raw-selector            |      0 | STALE_TARGET           | e434863c-3267-4b59-b677-7629501a75a2 |
| pilot  | stale-004      | prism-no-validation     |      0 | STALE_TARGET           | 67213a0f-2171-4ceb-ae80-7c63bc9569c3 |
| pilot  | stale-004      | prism-full              |      0 | MODEL_OUTPUT_ERROR     | 4a079b14-41a0-4e03-ae90-6e4af9bb5bd1 |
| pilot  | stale-006      | prism-no-stale-recovery |      0 | STALE_TARGET           | 15491663-593e-42ae-96d5-d708171e8b9a |
| pilot  | ambiguity-005  | raw-selector            |      0 | MODEL_OUTPUT_ERROR     | 63cc68b4-c870-40d5-b35d-a5c989b6a98f |
| pilot  | ambiguity-007  | prism-full              |      0 | MODEL_OUTPUT_ERROR     | b632aea7-0f3c-4684-8c13-ee36941a280b |
| pilot  | ambiguity-008  | prism-full              |      0 | MODEL_OUTPUT_ERROR     | 6e243051-f599-446b-ab9f-704e20f0821d |
| pilot  | ambiguity-008  | prism-no-stale-recovery |      0 | MODEL_OUTPUT_ERROR     | aaa347fc-6d4d-4301-b86e-d937f372284b |
| pilot  | navigation-001 | prism-full              |      0 | MODEL_OUTPUT_ERROR     | aa9d9ec9-c392-4c9b-85a2-679faff1c04f |
| pilot  | grounding-004  | raw-selector            |      1 | INVALID_ACTION         | 031b874f-dbda-4056-9159-f273befd8dde |
| pilot  | stale-001      | prism-full              |      1 | MODEL_OUTPUT_ERROR     | ab27fbf3-cf86-4315-8954-d4cbc939c3da |
| pilot  | stale-001      | prism-no-stale-recovery |      1 | STALE_TARGET           | 1c62a0d8-4f0f-4a67-bf5f-ae6c66eb8516 |
| pilot  | grounding-003  | prism-full              |      1 | ACTION_GROUNDING_ERROR | cc16ddc5-37e3-42bf-a16e-3cc118d0c232 |
| pilot  | stale-002      | prism-no-stale-recovery |      1 | STALE_TARGET           | de2eb654-cd8e-4d84-986d-5282bf070b25 |
| pilot  | stale-004      | prism-no-stale-recovery |      1 | STALE_TARGET           | d610db24-10d6-4eb8-a009-d2116110b474 |
| pilot  | stale-004      | prism-no-validation     |      1 | MODEL_OUTPUT_ERROR     | 3f5b86fd-affb-48df-9329-22e9faac8436 |
| pilot  | stale-005      | prism-no-stale-recovery |      1 | STALE_TARGET           | 0d9088a4-8ce5-4bd9-857d-8be4f47e9de0 |
| pilot  | stale-006      | prism-no-stale-recovery |      1 | STALE_TARGET           | d4953390-2d4f-4c12-bbec-db6bd44edb90 |
| pilot  | ambiguity-001  | prism-no-validation     |      1 | MODEL_OUTPUT_ERROR     | fbe2450a-26a6-4335-a6af-f5306f950457 |
| pilot  | stale-004      | raw-selector            |      1 | STALE_TARGET           | 36a60f6c-61eb-4746-8d82-52efada7c182 |
| pilot  | stale-004      | prism-full              |      1 | STALE_TARGET           | 34835a6c-79ec-4c29-a829-82507d3d59d1 |
| pilot  | ambiguity-002  | prism-full              |      1 | MODEL_OUTPUT_ERROR     | 9b9dd59b-19a1-4488-9267-14a8891a5382 |
| pilot  | ambiguity-002  | prism-no-stale-recovery |      1 | MODEL_OUTPUT_ERROR     | db970455-8b16-412c-9614-9e450e639b64 |
| pilot  | ambiguity-002  | raw-selector            |      1 | MODEL_OUTPUT_ERROR     | c9cd3725-e64c-442e-94bc-1a0c6ec3023f |
| pilot  | form-001       | raw-selector            |      1 | MODEL_OUTPUT_ERROR     | 1998a1f7-0ca6-43f2-a6f7-d2f3c91bbcae |
| pilot  | grounding-001  | prism-full              |      2 | MODEL_OUTPUT_ERROR     | 30485ca7-7442-4a34-b465-834447f6c750 |
| pilot  | grounding-001  | prism-no-stale-recovery |      2 | MODEL_OUTPUT_ERROR     | 10dbfb9b-0114-4ab8-876e-e7ad37f74ce9 |
| pilot  | grounding-004  | raw-selector            |      2 | INVALID_ACTION         | ac6738d2-cbca-43fe-ac28-9f840371d20f |
| pilot  | stale-001      | prism-no-stale-recovery |      2 | STALE_TARGET           | 39227187-7078-4bc6-9c20-7b61502dcc6b |
| pilot  | stale-002      | prism-no-stale-recovery |      2 | STALE_TARGET           | 3fa88e30-9e05-4e45-89bc-45cd9cd71681 |
| pilot  | stale-004      | prism-full              |      2 | MODEL_OUTPUT_ERROR     | e3a39626-45a4-40a0-97c0-399a13b92275 |
| pilot  | stale-004      | prism-no-stale-recovery |      2 | STALE_TARGET           | c9159ccf-4d11-49c0-be0b-57db2fd8b70c |
| pilot  | stale-005      | prism-no-stale-recovery |      2 | STALE_TARGET           | 6cfc9a10-ca86-45d5-8445-94d0d7efb6c0 |
| pilot  | grounding-003  | prism-no-validation     |      2 | BUDGET_EXCEEDED        | 2a1cbc3b-07d4-48a9-8bd2-20f857193768 |
| pilot  | stale-004      | prism-no-validation     |      2 | STALE_TARGET           | 8184e127-1875-48f5-8e1a-5a128c2ec738 |
| pilot  | stale-006      | prism-no-stale-recovery |      2 | STALE_TARGET           | 07ffcbf2-6c4d-4a23-a535-c7573053c0e3 |
| pilot  | ambiguity-001  | prism-no-stale-recovery |      2 | MODEL_OUTPUT_ERROR     | 9068596c-f329-4158-b6de-a274633c3d22 |
| pilot  | ambiguity-002  | prism-full              |      2 | MODEL_OUTPUT_ERROR     | 0925262f-6f96-45aa-9509-fca9cd00c62e |
| pilot  | ambiguity-003  | raw-selector            |      2 | MODEL_OUTPUT_ERROR     | 8b781a1a-5e2c-4e93-a2a4-7dcec463b3e0 |
| pilot  | ambiguity-010  | raw-selector            |      2 | MODEL_OUTPUT_ERROR     | 4305d2f9-58f2-4f98-80dd-4f09887b9ad1 |
| pilot  | form-001       | raw-selector            |      2 | MODEL_OUTPUT_ERROR     | 7e1d4787-5e8c-4665-81ae-a809dd555dfd |

## Representative traces

### grounding-002 / prism-full / repeat 0

Run: `9e00f402-9cf4-4e72-b152-d2e60da8e649`. Cohort: main. Failure:
**MODEL_OUTPUT_ERROR**. Reason: Invalid TypeSafe response; no action executed..

| Turn | Action | Target / Selector | Valid / Validation | Executed | Stale / Recovered | Confidence | Failure            |
| ---: | ------ | ----------------- | ------------------ | -------- | ----------------- | ---------- | ------------------ |
|    1 | CLICK  | 2                 | true / false       | false    | 0 / 0             | 0.99       | MODEL_OUTPUT_ERROR |

Decisive turn (full surrounding evidence, raw output and prompt hash are retained in
JSONL):

```json
{
  "goal": "Save the draft, without publishing it.",
  "page_text": "Similar Labels\nUse the controls below.\nSave and publish\nSave draft\nPending",
  "targets": {
    "CLICK": {
      "1": {
        "label": "Save and publish",
        "role": "button",
        "value": ""
      },
      "2": {
        "label": "Save draft",
        "role": "button",
        "value": ""
      }
    }
  },
  "dom": "<body>\n    <h1>Similar Labels</h1>\n    <p id=\"revision\">Use the controls below.</p>\n    <main id=\"controls\">\n      <button>Save and publish</button><button>Save draft</button>\n    </main>\n    \n    <p id=\"result\" role=\"status\">Pending</p>\n    \n  \n\n</body>",
  "confidence": 0.99,
  "raw_output": "{\"operation\":{\"choice\":\"CLICK\",\"probabilities\":{\"CLICK\":1},\"confidence\":0.99},\"target\":{\"choice\":\"2\",\"probabilities\":{\"2\":1,\"1\":0},\"confidence\":0.99},\"text\":null}",
  "error": "Invalid TypeSafe response; no action executed.",
  "provider_error": null
}
```

### grounding-004 / raw-selector / repeat 0

Run: `96159b5c-261a-473c-becc-dec1b02a31ec`. Cohort: main. Failure: **INVALID_ACTION**.
Reason: Invalid selector: multiple-match; no action executed..

| Turn | Action | Target / Selector    | Valid / Validation | Executed | Stale / Recovered | Confidence | Failure        |
| ---: | ------ | -------------------- | ------------------ | -------- | ----------------- | ---------- | -------------- |
|    1 | CLICK  | main#controls button | false / true       | false    | 0 / 0             | 0.95       | INVALID_ACTION |

Decisive turn (full surrounding evidence, raw output and prompt hash are retained in
JSONL):

```json
{
  "goal": "Confirm the visible invitation.",
  "page_text": "Hidden Visible\nUse the controls below.\nConfirm invitation\nPending",
  "targets": {
    "CLICK": {
      "candidate-1": {
        "label": "Confirm invitation",
        "role": "button",
        "value": ""
      }
    }
  },
  "dom": "<body>\n    <h1>Hidden Visible</h1>\n    <p id=\"revision\">Use the controls below.</p>\n    <main id=\"controls\">\n      <button>Confirm invitation</button>\n    </main>\n    \n    <p id=\"result\" role=\"status\">Pending</p>\n    \n  \n\n</body>",
  "confidence": 0.95,
  "raw_output": "{\"operation\":{\"choice\":\"CLICK\",\"probabilities\":{\"CLICK\":0.95,\"WAIT\":0.02,\"DONE\":0.02,\"BLOCKED\":0.01},\"confidence\":0.95},\"target\":{\"choice\":\"main#controls button\",\"probabilities\":{\"main#controls button\":0.9,\"button\":0.1},\"confidence\":0.95},\"text\":null}",
  "error": "Invalid selector: multiple-match; no action executed.",
  "provider_error": null
}
```

### stale-001 / prism-no-stale-recovery / repeat 0

Run: `730676e5-b686-49d3-9089-b13d252af3ed`. Cohort: main. Failure: **STALE_TARGET**.
Reason: Page changed since this decision. Observe again..

| Turn | Action | Target / Selector | Valid / Validation | Executed | Stale / Recovered | Confidence | Failure      |
| ---: | ------ | ----------------- | ------------------ | -------- | ----------------- | ---------- | ------------ |
|    1 | CLICK  | 2                 | true / true        | false    | 1 / 0             | 0.95       | STALE_TARGET |

Decisive turn (full surrounding evidence, raw output and prompt hash are retained in
JSONL):

```json
{
  "goal": "Delete Item B.",
  "page_text": "Rerender\nUse the controls below.\nItem A\nDelete Item A\nItem B\nDelete Item B\nPending",
  "targets": {
    "CLICK": {
      "1": {
        "label": "Delete Item A",
        "role": "button",
        "value": ""
      },
      "2": {
        "label": "Delete Item B",
        "role": "button",
        "value": ""
      }
    }
  },
  "dom": "<body>\n    <h1>Rerender</h1>\n    <p id=\"revision\">Use the controls below.</p>\n    <main id=\"controls\">\n      <article>Item A <button>Delete Item A</button></article>\n      <article>\n        Item B <button>Delete Item B</button>\n      </article>\n    </main>\n    \n    <p id=\"result\" role=\"status\">Pending</p>\n    \n  \n\n</body>",
  "confidence": 0.95,
  "raw_output": "{\"operation\":{\"choice\":\"CLICK\",\"probabilities\":{\"CLICK\":1.0,\"WAIT\":0.0,\"DONE\":0.0,\"BLOCKED\":0.0},\"confidence\":0.95},\"target\":{\"choice\":\"2\",\"probabilities\":{\"1\":0.0,\"2\":1.0},\"confidence\":0.95},\"text\":null}",
  "error": "Page changed since this decision. Observe again.",
  "provider_error": null
}
```

### grounding-003 / raw-selector / repeat 0

Run: `6925b1d0-45dd-4c17-9f78-343b8fdbe022`. Cohort: main. Failure: **BUDGET_EXCEEDED**.
Reason: Evaluation wall-clock budget exceeded..

| Turn | Action | Target / Selector               | Valid / Validation | Executed | Stale / Recovered | Confidence | Failure         |
| ---: | ------ | ------------------------------- | ------------------ | -------- | ----------------- | ---------- | --------------- |
|    1 | CLICK  | #controls button:nth-of-type(2) | true / true        | true     | 0 / 0             | 0.95       | —               |
|    2 | —      | —                               | null / null        | false    | 0 / 0             | n/a        | BUDGET_EXCEEDED |

Decisive turn (full surrounding evidence, raw output and prompt hash are retained in
JSONL):

```json
{
  "goal": "Archive Project Atlas, keeping its backup.",
  "page_text": "Semantic Target\nUse the controls below.\nArchive Atlas backup\nArchive Project Atlas\nAtlas archived",
  "targets": {
    "CLICK": {
      "candidate-1": {
        "label": "Archive Atlas backup",
        "role": "button",
        "value": ""
      }
    }
  },
  "dom": "<body>\n    <h1>Semantic Target</h1>\n    <p id=\"revision\">Use the controls below.</p>\n    <main id=\"controls\">\n      <button>Archive Atlas backup</button><button disabled=\"\">Archive Project Atlas</button>\n    </main>\n    \n    <p id=\"result\" role=\"status\">Atlas archived</p>\n    \n  \n\n</body>",
  "confidence": null,
  "raw_output": null,
  "error": "Evaluation wall-clock budget exceeded.",
  "provider_error": null
}
```

### stale-004 / prism-no-validation / repeat 0

Run: `f77630e9-304d-4b0c-b8ee-6859b46d4c8b`. Cohort: main. Failure: **STALE_TARGET**.
Reason: The page kept changing before the action could run..

| Turn | Action | Target / Selector | Valid / Validation | Executed | Stale / Recovered | Confidence | Failure      |
| ---: | ------ | ----------------- | ------------------ | -------- | ----------------- | ---------- | ------------ |
|    1 | CLICK  | 2                 | true / true        | false    | 1 / 0             | 0.95       | STALE_TARGET |
|    2 | CLICK  | 2                 | true / true        | false    | 1 / 0             | 0.95       | STALE_TARGET |
|    3 | CLICK  | 2                 | true / true        | false    | 1 / 0             | 0.98       | STALE_TARGET |
|    4 | CLICK  | 2                 | true / false       | false    | 1 / 0             | 0.95       | STALE_TARGET |
|    5 | CLICK  | 2                 | true / true        | false    | 1 / 0             | 0.95       | STALE_TARGET |
|    6 | CLICK  | 2                 | true / false       | false    | 1 / 0             | 0.95       | STALE_TARGET |

Decisive turn (full surrounding evidence, raw output and prompt hash are retained in
JSONL):

```json
{
  "goal": "Save the draft. Dismiss the update notice if it appears.",
  "page_text": "Delayed Modal\nUse the controls below.\nPublish draft\nSave draft\nA new revision is available.\nDismiss update notice\nPending",
  "targets": {
    "CLICK": {
      "1": {
        "label": "Publish draft",
        "role": "button",
        "value": ""
      },
      "2": {
        "label": "Save draft",
        "role": "button",
        "value": ""
      },
      "3": {
        "label": "Dismiss update notice",
        "role": "button",
        "value": ""
      }
    }
  },
  "dom": "<body>\n    <h1>Delayed Modal</h1>\n    <p id=\"revision\">Use the controls below.</p>\n    <main id=\"controls\">\n      <button>Publish draft</button><button>Save draft</button>\n    </main>\n    <dialog id=\"notice\">\n      <p>A new revision is available.</p>\n      <button id=\"dismiss\">Dismiss update notice</button>\n    </dialog>\n    <p id=\"result\" role=\"status\">Pending</p>\n    \n  \n\n</body>",
  "confidence": 0.95,
  "raw_output": "{\"operation\":{\"choice\":\"CLICK\",\"probabilities\":{\"1\":0.0,\"2\":0.95,\"3\":0.05},\"confidence\":0.95},\"target\":{\"choice\":\"2\",\"probabilities\":{\"2\":0.95,\"1\":0.03,\"3\":0.02},\"confidence\":0.95},\"text\":null}",
  "error": "Target changed or is covered. Observe again.",
  "provider_error": null
}
```

### ambiguity-008 / raw-selector / repeat 0

Run: `7a5d254b-0056-4d37-9f44-156fa75ff181`. Cohort: main. Failure:
**MODEL_OUTPUT_ERROR**. Reason: Invalid TypeSafe response; no action executed..

| Turn | Action | Target / Selector                       | Valid / Validation | Executed | Stale / Recovered | Confidence | Failure            |
| ---: | ------ | --------------------------------------- | ------------------ | -------- | ----------------- | ---------- | ------------------ |
|    1 | CLICK  | #controls section:nth-of-type(2) button | true / false       | false    | 0 / 0             | 0.97       | MODEL_OUTPUT_ERROR |

Decisive turn (full surrounding evidence, raw output and prompt hash are retained in
JSONL):

```json
{
  "goal": "Delete Project Atlas. Do not delete any other entry.",
  "page_text": "Manage entries\nProject Orion\nDelete\nProject Atlas\nDelete\nPending",
  "targets": {
    "CLICK": {
      "candidate-1": {
        "label": "Delete",
        "role": "button",
        "value": ""
      },
      "candidate-2": {
        "label": "Delete",
        "role": "button",
        "value": ""
      }
    }
  },
  "dom": "<body>\n    <h1>Manage entries</h1>\n    <main id=\"controls\">\n      <section class=\"entry\">\n        <h2>Project Orion</h2>\n        <button type=\"button\">Delete</button>\n      </section>\n      <section class=\"entry\">\n        <h2>Project Atlas</h2>\n        <button type=\"button\">Delete</button>\n      </section>\n    </main>\n    \n    <p id=\"result\" role=\"status\">Pending</p>\n    \n  \n\n</body>",
  "confidence": 0.97,
  "raw_output": "{\"operation\":{\"choice\":\"CLICK\",\"probabilities\":{\"CLICK\":1.0},\"confidence\":0.97},\"target\":{\"choice\":\"#controls section:nth-of-type(2) button\",\"probabilities\":{\"#controls section:nth-of-type(2) button\":0.9,\"section.entry:nth-of-type(2) > button\":0.1},\"confidence\":0.97},\"text\":null}",
  "error": "Invalid TypeSafe response; no action executed.",
  "provider_error": null
}
```

### ambiguity-008 / prism-no-stale-recovery / repeat 0

Run: `96c6a960-8a91-4b8e-95ed-1f215be72975`. Cohort: main. Failure:
**MODEL_OUTPUT_ERROR**. Reason: Invalid TypeSafe response; no action executed..

| Turn | Action | Target / Selector | Valid / Validation | Executed | Stale / Recovered | Confidence | Failure            |
| ---: | ------ | ----------------- | ------------------ | -------- | ----------------- | ---------- | ------------------ |
|    1 | CLICK  | 2                 | true / true        | true     | 0 / 0             | 0.95       | —                  |
|    2 | —      | —                 | false / false      | false    | 0 / 0             | n/a        | MODEL_OUTPUT_ERROR |

Decisive turn (full surrounding evidence, raw output and prompt hash are retained in
JSONL):

```json
{
  "goal": "Delete Project Atlas. Do not delete any other entry.",
  "page_text": "Manage entries\nProject Orion\nDelete\nProject Atlas\nDelete\nDelete completed for Project Atlas",
  "targets": {
    "CLICK": {
      "1": {
        "label": "Delete",
        "role": "button",
        "value": ""
      }
    }
  },
  "dom": "<body>\n    <h1>Manage entries</h1>\n    <main id=\"controls\">\n      <section class=\"entry\">\n        <h2>Project Orion</h2>\n        <button type=\"button\">Delete</button>\n      </section>\n      <section class=\"entry\">\n        <h2>Project Atlas</h2>\n        <button type=\"button\" disabled=\"\">Delete</button>\n      </section>\n    </main>\n    \n    <p id=\"result\" role=\"status\">Delete completed for Project Atlas</p>\n    \n  \n\n</body>",
  "confidence": null,
  "raw_output": "{\"operation\":{\"CLICK\":{\"choice\":\"CLICK\",\"probabilities\":{\"CLICK\":0.0},\"confidence\":0.0},\"WAIT\":{\"choice\":\"WAIT\",\"probabilities\":{\"WAIT\":0.0},\"confidence\":0.0},\"DONE\":{\"choice\":\"DONE\",\"probabilities\":{\"DONE\":1.0},\"confidence\":0.0},\"BLOCKED\":{\"choice\":\"BLOCKED\",\"probabilities\":{\"BLOCKED\":0.0},\"confidence\":0.0}},\"target\":null,\"text\":null}",
  "error": "Invalid TypeSafe response; no action executed.",
  "provider_error": null
}
```

### stale-004 / prism-no-validation / repeat 1

Run: `e0432a24-7c2f-4eb9-bc92-d219cb966df2`. Cohort: main. Failure:
**MODEL_OUTPUT_ERROR**. Reason: Invalid TypeSafe response; no action executed..

| Turn | Action | Target / Selector | Valid / Validation | Executed | Stale / Recovered | Confidence | Failure            |
| ---: | ------ | ----------------- | ------------------ | -------- | ----------------- | ---------- | ------------------ |
|    1 | CLICK  | 2                 | true / true        | false    | 1 / 0             | 0.95       | STALE_TARGET       |
|    2 | CLICK  | 2                 | true / true        | false    | 1 / 0             | 0.95       | STALE_TARGET       |
|    3 | CLICK  | 2                 | true / true        | false    | 1 / 0             | 0.95       | STALE_TARGET       |
|    4 | CLICK  | 2                 | true / true        | false    | 1 / 0             | 0.95       | STALE_TARGET       |
|    5 | CLICK  | 2                 | true / true        | false    | 1 / 0             | 0.95       | STALE_TARGET       |
|    6 | —      | —                 | false / false      | false    | 0 / 0             | n/a        | MODEL_OUTPUT_ERROR |

Decisive turn (full surrounding evidence, raw output and prompt hash are retained in
JSONL):

```json
{
  "goal": "Save the draft. Dismiss the update notice if it appears.",
  "page_text": "Delayed Modal\nUse the controls below.\nPublish draft\nSave draft\nA new revision is available.\nDismiss update notice\nPending",
  "targets": {
    "CLICK": {
      "1": {
        "label": "Publish draft",
        "role": "button",
        "value": ""
      },
      "2": {
        "label": "Save draft",
        "role": "button",
        "value": ""
      },
      "3": {
        "label": "Dismiss update notice",
        "role": "button",
        "value": ""
      }
    }
  },
  "dom": "<body>\n    <h1>Delayed Modal</h1>\n    <p id=\"revision\">Use the controls below.</p>\n    <main id=\"controls\">\n      <button>Publish draft</button><button>Save draft</button>\n    </main>\n    <dialog id=\"notice\">\n      <p>A new revision is available.</p>\n      <button id=\"dismiss\">Dismiss update notice</button>\n    </dialog>\n    <p id=\"result\" role=\"status\">Pending</p>\n    \n  \n\n</body>",
  "confidence": null,
  "raw_output": "{\"operation\":{\"CLICK\":{\"probabilities\":{\"CLICK\":1,\"WAIT\":0,\"DONE\":0,\"BLOCKED\":0},\"confidence\":0.9},\"target\":{\"CLICK\":{\"1\":0,\"2\":1,\"3\":0},\"choice\":\"2\",\"probabilities\":{\"1\":0,\"2\":1,\"3\":0},\"confidence\":0.9},\"text\":null} }",
  "error": "Invalid TypeSafe response; no action executed.",
  "provider_error": null
}
```

### grounding-003 / prism-no-stale-recovery / repeat 1

Run: `fb74fffa-a55b-4b47-b2f3-ebbf10157d5e`. Cohort: main. Failure:
**ACTION_GROUNDING_ERROR**. Reason: Evaluation wall-clock budget exceeded..

| Turn | Action | Target / Selector | Valid / Validation | Executed | Stale / Recovered | Confidence | Failure                |
| ---: | ------ | ----------------- | ------------------ | -------- | ----------------- | ---------- | ---------------------- |
|    1 | CLICK  | 2                 | true / true        | true     | 0 / 0             | 0.95       | —                      |
|    2 | CLICK  | 1                 | true / true        | true     | 0 / 0             | 0.8        | ACTION_GROUNDING_ERROR |
|    3 | —      | —                 | null / null        | false    | 0 / 0             | n/a        | ACTION_GROUNDING_ERROR |

Decisive turn (full surrounding evidence, raw output and prompt hash are retained in
JSONL):

```json
{
  "goal": "Archive Project Atlas, keeping its backup.",
  "page_text": "Semantic Target\nUse the controls below.\nArchive Atlas backup\nArchive Project Atlas\nAtlas archived",
  "targets": {
    "CLICK": {
      "1": {
        "label": "Archive Atlas backup",
        "role": "button",
        "value": ""
      }
    }
  },
  "dom": "<body>\n    <h1>Semantic Target</h1>\n    <p id=\"revision\">Use the controls below.</p>\n    <main id=\"controls\">\n      <button>Archive Atlas backup</button><button disabled=\"\">Archive Project Atlas</button>\n    </main>\n    \n    <p id=\"result\" role=\"status\">Atlas archived</p>\n    \n  \n\n</body>",
  "confidence": 0.9,
  "raw_output": "{\"operation\":{\"choice\":\"CLICK\",\"probabilities\":{\"CLICK\":0.9,\"WAIT\":0.02,\"DONE\":0.06,\"BLOCKED\":0.02},\"confidence\":0.8},\"target\":{\"choice\":\"1\",\"probabilities\":{\"1\":1.0},\"confidence\":0.9},\"text\":null}",
  "error": null,
  "provider_error": null
}
```

### stale-004 / raw-selector / repeat 1

Run: `a40d2db3-2a7c-4888-8e17-b4a738e00c4b`. Cohort: main. Failure: **STALE_TARGET**.
Reason: The page kept changing before the action could run..

| Turn | Action | Target / Selector                   | Valid / Validation | Executed | Stale / Recovered | Confidence | Failure      |
| ---: | ------ | ----------------------------------- | ------------------ | -------- | ----------------- | ---------- | ------------ |
|    1 | CLICK  | #controls button:nth-of-type(2)     | true / true        | false    | 1 / 0             | 0.95       | STALE_TARGET |
|    2 | CLICK  | #controls button:nth-of-type(2)     | true / true        | false    | 1 / 0             | 0.92       | STALE_TARGET |
|    3 | CLICK  | main#controls button:nth-of-type(2) | true / true        | false    | 1 / 0             | 0.92       | STALE_TARGET |
|    4 | CLICK  | #controls button:nth-of-type(2)     | true / true        | false    | 1 / 0             | 0.9        | STALE_TARGET |
|    5 | CLICK  | #controls button:nth-of-type(2)     | true / true        | false    | 1 / 0             | 0.9        | STALE_TARGET |
|    6 | CLICK  | #controls button:nth-of-type(2)     | true / true        | false    | 1 / 0             | 0.92       | STALE_TARGET |

Decisive turn (full surrounding evidence, raw output and prompt hash are retained in
JSONL):

```json
{
  "goal": "Save the draft. Dismiss the update notice if it appears.",
  "page_text": "Delayed Modal\nUse the controls below.\nPublish draft\nSave draft\nA new revision is available.\nDismiss update notice\nPending",
  "targets": {
    "CLICK": {
      "candidate-1": {
        "label": "Publish draft",
        "role": "button",
        "value": ""
      },
      "candidate-2": {
        "label": "Save draft",
        "role": "button",
        "value": ""
      },
      "candidate-3": {
        "label": "Dismiss update notice",
        "role": "button",
        "value": ""
      }
    }
  },
  "dom": "<body>\n    <h1>Delayed Modal</h1>\n    <p id=\"revision\">Use the controls below.</p>\n    <main id=\"controls\">\n      <button>Publish draft</button><button>Save draft</button>\n    </main>\n    <dialog id=\"notice\">\n      <p>A new revision is available.</p>\n      <button id=\"dismiss\">Dismiss update notice</button>\n    </dialog>\n    <p id=\"result\" role=\"status\">Pending</p>\n    \n  \n\n</body>",
  "confidence": 0.92,
  "raw_output": "{\"operation\":{\"choice\":\"CLICK\",\"probabilities\":{\"CLICK\":0.95,\"WAIT\":0.03,\"DONE\":0.01,\"BLOCKED\":0.01},\"confidence\":0.92},\"target\":{\"choice\":\"#controls button:nth-of-type(2)\",\"probabilities\":{\"#controls button:nth-of-type(2)\":0.9,\"main#controls button:nth-of-type(2)\":0.1},\"confidence\":0.92},\"text\":null}",
  "error": "Target changed or is covered. Observe again.",
  "provider_error": null
}
```
