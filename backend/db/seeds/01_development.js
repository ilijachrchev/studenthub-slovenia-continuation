/**
 * Development seed data for StudentHub Slovenia
 *
 * This seed provides test data for development and testing environments.
 * All inserts use onConflict().ignore() to ensure idempotency.
 *
 * Passwords (bcrypt hashed):
 *   admin@studenthub.test     → admin123
 *   organizer@studenthub.test → organizer123
 *   student@famnit.upr.si     → student123
 *
 * Dependencies:
 *   - Requires all tables to exist (run migrations first)
 *   - Inserts in dependency order to satisfy foreign key constraints
 *
 * Usage:
 *   npm run db:seed
 */

exports.seed = async function (knex) {
  // Verify required tables exist before seeding
  const requiredTables = [
    "university",
    "faculty",
    "tag",
    "user",
    "admin",
    "organization",
    "organizer_profile",
    "event",
    "event_tag",
    "event_target",
    "student_profile",
    "user_interest",
    "bookmark",
    "registration",
    "feedback",
    "opportunity",
    "opportunity_tag",
  ];

  const missingTables = [];
  for (const table of requiredTables) {
    if (!(await knex.schema.hasTable(table))) {
      missingTables.push(table);
    }
  }

  if (missingTables.length > 0) {
    throw new Error(
      `Cannot seed: missing required tables. Run migrations first.\n` +
        `Missing: ${missingTables.join(", ")}`
    );
  }

  // Universities
  await knex("university").insert([
    { id: 1, name: "Univerza na Primorskem" },
    { id: 2, name: "Univerza v Ljubljani" },
    { id: 3, name: "Univerza v Mariboru" },
  ]).onConflict("id").ignore();

  // Faculties
  await knex("faculty").insert([
    { id: 1, name: "Fakulteta za matematiko, naravoslovje in informacijske tehnologije", email_domain: "famnit.upr.si", university_id: 1 },
    { id: 2, name: "Fakulteta za humanistične študije", email_domain: "fhsh.upr.si", university_id: 1 },
    { id: 3, name: "Fakulteta za management", email_domain: "fm.upr.si", university_id: 1 },
    { id: 4, name: "Fakulteta za računalništvo in informatiko", email_domain: "fri.uni-lj.si", university_id: 2 },
    { id: 5, name: "Fakulteta za elektrotehniko", email_domain: "fe.uni-lj.si", university_id: 2 },
    { id: 6, name: "Fakulteta za strojništvo", email_domain: "fs.uni-lj.si", university_id: 2 },
    { id: 7, name: "Fakulteta za naravoslovje in matematiko", email_domain: "fnm.um.si", university_id: 3 },
    { id: 8, name: "Ekonomsko-poslovna fakulteta", email_domain: "epf.um.si", university_id: 3 },
  ]).onConflict("id").ignore();

  // Tags
  await knex("tag").insert([
    { id: 1, name: "Workshop" },
    { id: 2, name: "Lecture" },
    { id: 3, name: "Hackathon" },
    { id: 4, name: "Social" },
    { id: 5, name: "Career" },
    { id: 6, name: "Competition" },
    { id: 7, name: "Conference" },
    { id: 8, name: "Meetup" },
  ]).onConflict("id").ignore();

  // Users
  await knex("user").insert([
    { id: 1, first_name: "Admin", last_name: "User", email: "admin@studenthub.test", password_hash: "$2b$10$7SIIxh22r.4sGjfhTDxufeNN5uT1tYp/YhLxeqvvG08vRCZLMPOQC", role: "admin" },
    { id: 2, first_name: "Organizer", last_name: "User", email: "organizer@studenthub.test", password_hash: "$2b$10$yP0MijK2H34UNQNzZB5Um.NUcoy/yphlLRkSpGzQiZZw/SxD7PHa.", role: "organizer" },
    { id: 3, first_name: "Student", last_name: "User", email: "student@famnit.upr.si", password_hash: "$2b$10$skZUBTrWNACrjlPFCsgjAOGI8ZtCUe5h87CuFTP.SPr5.0v0jdM/S", role: "student" },
  ]).onConflict("id").ignore();

  // Admin profile
  await knex("admin").insert([{ user_id: 1 }]).onConflict("user_id").ignore();

  // Organizations
  await knex("organization").insert([
    { id: 1, name: "Open Source Club", description: "Building cool open-source projects together.", logo: null, website: "https://example.org", contact_email: "oss@studenthub.test", university_id: 1, status: "approved", approved_at: knex.fn.now() },
    { id: 2, name: "AI Research Group", description: "Exploring artificial intelligence and machine learning.", logo: null, website: "https://example.org/ai", contact_email: "ai@studenthub.test", university_id: 1, status: "pending", approved_at: null },
    { id: 3, name: "Game Dev Hub", description: "Indie game development workshops and jams.", logo: null, website: null, contact_email: "gamedev@studenthub.test", university_id: 2, status: "approved", approved_at: knex.fn.now() },
  ]).onConflict("id").ignore();

  // Organizer profiles
  await knex("organizer_profile").insert([
    { user_id: 2, organization_id: 1, role_in_org: "owner" },
  ]).onConflict(["user_id", "organization_id"]).ignore();

  // Opportunities
  await knex("opportunity").insert([
    {
      id: 1,
      organization_id: 1,
      title: "Open Source Sprint",
      summary: "Hands-on contribution session for students new to open source.",
      description: "Mentored sprint focused on fixing small issues and reviewing pull requests.",
      location: "FAMNIT, Koper",
      status: "published",
      deadline: "2026-12-15 23:59:00",
      application_deadline: "2026-12-15 23:59:00",
      start_date: "2026-12-20 09:00:00",
      end_date: "2026-12-20 17:00:00",
      capacity: 25,
      compensation: null,
      contact_email: "oss@studenthub.test",
      apply_url: "https://example.org/open-source-sprint",
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
      published_at: knex.fn.now(),
      closed_at: null,
      archived_at: null,
    },
    {
      id: 2,
      organization_id: 1,
      title: "Career Prep Clinic",
      summary: "CV review and interview preparation for students.",
      description: "Peer-led clinic with short workshops and one-on-one feedback sessions.",
      location: "FAMNIT, Koper",
      status: "published",
      deadline: "2026-12-20 23:59:00",
      application_deadline: "2026-12-20 23:59:00",
      start_date: "2026-12-28 10:00:00",
      end_date: "2026-12-28 13:00:00",
      capacity: 40,
      compensation: null,
      contact_email: "oss@studenthub.test",
      apply_url: "https://example.org/career-prep",
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
      published_at: knex.fn.now(),
      closed_at: null,
      archived_at: null,
    },
  ]).onConflict("id").ignore();

  // Events
  await knex("event").insert([
    { id: 1, organization_id: 1, title: "Git & GitHub Workshop", description: "Learn version control from scratch. Bring your laptop!", location: "FAMNIT MP2, Koper", start_datetime: "2026-09-15 17:00:00", end_datetime: "2026-09-15 19:00:00", capacity: 30, registration_type: "built_in", external_url: null, status: "published", created_at: knex.fn.now() },
    { id: 2, organization_id: 1, title: "Intro to Open Source", description: "How to find and contribute to open-source projects.", location: "FAMNIT PI, Koper", start_datetime: "2026-10-01 16:00:00", end_datetime: "2026-10-01 18:00:00", capacity: 40, registration_type: "built_in", external_url: null, status: "published", created_at: knex.fn.now() },
    { id: 3, organization_id: 3, title: "Game Jam Weekend", description: "48-hour game jam. Form teams on-site or come solo.", location: "FERI, Maribor", start_datetime: "2026-11-08 09:00:00", end_datetime: "2026-11-09 17:00:00", capacity: null, registration_type: "external", external_url: "https://itch.io/jam/gamejam", status: "published", created_at: knex.fn.now() },
    { id: 4, organization_id: 1, title: "Hackathon 2026", description: "Annual student hackathon. Teams of 2-4.", location: "FAMNIT, Koper", start_datetime: "2026-12-01 08:00:00", end_datetime: "2026-12-02 20:00:00", capacity: 60, registration_type: "built_in", external_url: null, status: "draft", created_at: knex.fn.now() },
    { id: 5, organization_id: 1, title: "End-of-Semester Party", description: "Celebrate finishing exams with us!", location: "TBA, Koper", start_datetime: "2027-01-20 20:00:00", end_datetime: "2027-01-20 23:59:00", capacity: null, registration_type: "none", external_url: null, status: "submitted", created_at: knex.fn.now() },
    { id: 6, organization_id: 3, title: "VR Workshop", description: "Hands-on introduction to virtual reality development.", location: "FERI Lab 3, Maribor", start_datetime: "2026-08-01 14:00:00", end_datetime: "2026-08-01 17:00:00", capacity: 20, registration_type: "built_in", external_url: null, status: "published", created_at: knex.fn.now() },
  ]).onConflict("id").ignore();

  // Event tags
  await knex("event_tag").insert([
    { event_id: 1, tag_id: 1 }, { event_id: 1, tag_id: 5 },
    { event_id: 2, tag_id: 1 }, { event_id: 2, tag_id: 8 },
    { event_id: 3, tag_id: 3 }, { event_id: 3, tag_id: 6 },
    { event_id: 4, tag_id: 3 },
    { event_id: 5, tag_id: 4 },
    { event_id: 6, tag_id: 1 },
  ]).onConflict(["event_id", "tag_id"]).ignore();

  // Event targets
  await knex("event_target").insert([
    { event_id: 1, faculty_id: 1 }, { event_id: 1, faculty_id: 4 },
    { event_id: 2, faculty_id: 1 },
    { event_id: 3, faculty_id: 4 }, { event_id: 3, faculty_id: 5 },
    { event_id: 4, faculty_id: 1 }, { event_id: 4, faculty_id: 4 },
    { event_id: 5, faculty_id: 1 },
    { event_id: 6, faculty_id: 4 },
  ]).onConflict(["event_id", "faculty_id"]).ignore();

  await knex("opportunity_tag").insert([
    { opportunity_id: 1, tag_id: 1 },
    { opportunity_id: 1, tag_id: 5 },
    { opportunity_id: 2, tag_id: 5 },
  ]).onConflict(["opportunity_id", "tag_id"]).ignore();

  // Student profile & interests
  await knex("student_profile").insert([
    { user_id: 3, faculty_id: 1, study_year: 3 },
  ]).onConflict("user_id").ignore();

  await knex("user_interest").insert([
    { user_id: 3, tag_id: 1 }, { user_id: 3, tag_id: 3 }, { user_id: 3, tag_id: 5 },
  ]).onConflict(["user_id", "tag_id"]).ignore();

  // Bookmarks
  await knex("bookmark").insert([
    { user_id: 3, event_id: 1 },
    { user_id: 3, event_id: 3 },
  ]).onConflict(["user_id", "event_id"]).ignore();

  // Registrations
  await knex("registration").insert([
    { user_id: 3, event_id: 6, ticket_code: "DEVS-TEST-SEED" },
  ]).onConflict(["user_id", "event_id"]).ignore();

  // Feedback
  await knex("feedback").insert([
    { user_id: 3, event_id: 6, rating: 5, comment: "Great intro to VR, looking forward to more!" },
  ]).onConflict(["user_id", "event_id"]).ignore();
};
