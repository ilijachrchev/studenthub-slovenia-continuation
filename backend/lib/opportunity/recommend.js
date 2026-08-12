const pool = require("../../db");

function placeholders(count) {
  return Array.from({ length: count }, (_, index) => `$${index + 1}`);
}

function toMap(rows, key) {
  return rows.reduce((acc, row) => {
    if (!acc[row[key]]) acc[row[key]] = [];
    acc[row[key]].push(row);
    return acc;
  }, {});
}

function buildReasons(tagMatches, facultyMatch) {
  const reasons = [];

  if (facultyMatch) {
    reasons.push({
      type: "faculty",
      score: 18,
      text: "Matches your faculty target",
    });
  }

  if (tagMatches.length > 0) {
    reasons.push({
      type: "interests",
      score: tagMatches.length * 10,
      text: `Matches ${tagMatches.length} interest tag${tagMatches.length === 1 ? "" : "s"}`,
    });
  }

  return reasons.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type));
}

async function getRecommendations(userId, limit = 10) {
  const safeLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));

  const [
    { rows: profileRows },
    { rows: interestRows },
    { rows: opportunityRows },
  ] = await Promise.all([
    pool.query(
      "SELECT faculty_id FROM student_profile WHERE user_id = $1",
      [userId]
    ),
    pool.query(
      "SELECT tag_id FROM user_interest WHERE user_id = $1",
      [userId]
    ),
    pool.query(
      `SELECT e.id, e.title, e.description, e.location,
              e.start_datetime, e.end_datetime, e.capacity,
              e.registration_type, e.external_url,
              o.id AS organization_id, o.name AS organization_name
       FROM event e
       JOIN organization o ON o.id = e.organization_id
       WHERE e.status = 'published'
         AND o.status = 'approved'
         AND e.start_datetime >= NOW()
       ORDER BY e.start_datetime ASC, e.id ASC`
    ),
  ]);

  if (opportunityRows.length === 0) {
    return [];
  }

  const opportunityIds = opportunityRows.map((row) => row.id);
  const ph = placeholders(opportunityIds.length);

  const [tagRows, targetRows] = await Promise.all([
    pool.query(
      `SELECT et.event_id AS opportunity_id, t.id, t.name
       FROM event_tag et
       JOIN tag t ON t.id = et.tag_id
       WHERE et.event_id IN (${ph})`,
      opportunityIds
    ),
    pool.query(
      `SELECT event_id AS opportunity_id, faculty_id
       FROM event_target
       WHERE event_id IN (${ph})`,
      opportunityIds
    ),
  ]);

  const interestTagIds = new Set(interestRows.map((row) => row.tag_id));
  const userFacultyId = profileRows[0]?.faculty_id || null;
  const tagsByOpportunity = toMap(tagRows.rows, "opportunity_id");
  const targetsByOpportunity = toMap(targetRows.rows, "opportunity_id");

  const scored = opportunityRows.map((opportunity) => {
    const tags = tagsByOpportunity[opportunity.id] || [];
    const targets = targetsByOpportunity[opportunity.id] || [];
    const tagMatches = tags.filter((tag) => interestTagIds.has(tag.id));
    const facultyMatch = userFacultyId
      ? targets.some((target) => target.faculty_id === userFacultyId)
      : false;

    const reasons = buildReasons(tagMatches, facultyMatch);
    const score = reasons.reduce((sum, reason) => sum + reason.score, 0);

    return {
      ...opportunity,
      score,
      primary_reason: reasons[0]?.text || "General relevance",
      reasons: reasons.map((reason) => reason.text),
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aDate = new Date(a.start_datetime).getTime();
    const bDate = new Date(b.start_datetime).getTime();
    if (aDate !== bDate) return aDate - bDate;
    return a.id - b.id;
  });

  return scored.slice(0, safeLimit);
}

module.exports = { getRecommendations };


