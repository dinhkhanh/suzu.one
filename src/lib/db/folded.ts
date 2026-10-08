// A text column as `toSearchKey` (src/lib/text.ts) would have it, in SQL: lower case, without its
// marks, đ as d — so "thiet ke" meets "Thiết kế". Vietnamese letters by hand, since the database
// runs without the unaccent extension (as drizzle/0106_kb_slugs.sql does).
import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

const MARKED = "àáạảãâầấậẩẫăằắặẳẵäåāèéẹẻẽêềếệểễëēìíịỉĩïîòóọỏõôồốộổỗơờớợởỡöøùúụủũưừứựửữüûỳýỵỷỹÿđçñ";
const PLAIN = "aaaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeiiiiiiiooooooooooooooooooouuuuuuuuuuuuuyyyyyydcn";

export const folded = (column: AnyPgColumn | SQL): SQL => sql`regexp_replace(translate(lower(${column}), ${MARKED}, ${PLAIN}), '[̀-ͯ]', '', 'g')`;
