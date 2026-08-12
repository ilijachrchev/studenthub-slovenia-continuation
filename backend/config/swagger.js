const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "StudentHub Slovenia API",
      version: "1.0.0",
      description:
        "Backend API for StudentHub Slovenia — a platform connecting students with university events, organizations, and opportunities.",
      contact: { name: "StudentHub Team" },
    },
    servers: [
      { url: "http://localhost:30011", description: "Local development" },
    ],
    components: {
      securitySchemes: {
        sessionAuth: {
          type: "apiKey",
          in: "cookie",
          name: "connect.sid",
          description: "Session cookie set by login/register endpoints",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: { type: "string", example: "Something went wrong" },
          },
        },
        User: {
          type: "object",
          properties: {
            id: { type: "integer" },
            first_name: { type: "string" },
            last_name: { type: "string" },
            email: { type: "string", format: "email" },
            role: { type: "string", enum: ["student", "organizer", "admin"] },
          },
        },
        Event: {
          type: "object",
          properties: {
            id: { type: "integer" },
            title: { type: "string" },
            description: { type: "string", nullable: true },
            location: { type: "string" },
            start_datetime: { type: "string", format: "date-time" },
            end_datetime: { type: "string", format: "date-time" },
            capacity: { type: "integer", nullable: true },
            registration_type: {
              type: "string",
              enum: ["built_in", "external", "none"],
            },
            external_url: { type: "string", nullable: true },
            organization_id: { type: "integer" },
            organization_name: { type: "string" },
            tags: {
              type: "array",
              items: { $ref: "#/components/schemas/Tag" },
            },
          },
        },
        EventDetail: {
          allOf: [
            { $ref: "#/components/schemas/Event" },
            {
              type: "object",
              properties: {
                organization_description: { type: "string", nullable: true },
                organization_logo: { type: "string", nullable: true },
                organization_website: { type: "string", nullable: true },
                organization_contact_email: { type: "string" },
              },
            },
          ],
        },
        Organization: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            description: { type: "string", nullable: true },
            logo: { type: "string", nullable: true },
            website: { type: "string", nullable: true },
            contact_email: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "approved", "rejected"],
            },
            university_name: { type: "string", nullable: true },
          },
        },
        Registration: {
          type: "object",
          properties: {
            id: { type: "integer" },
            user_id: { type: "integer" },
            event_id: { type: "integer" },
            registered_at: { type: "string", format: "date-time" },
            ticket_code: {
              type: "string",
              example: "ABCD-EF23-45GH",
            },
            checked_in: { type: "boolean" },
          },
        },
        Tag: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
          },
        },
        Faculty: {
          type: "object",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            university_id: { type: "integer" },
            university_name: { type: "string" },
          },
        },
        Feedback: {
          type: "object",
          properties: {
            id: { type: "integer" },
            rating: { type: "integer", minimum: 1, maximum: 5 },
            comment: { type: "string", nullable: true },
            submitted_at: { type: "string", format: "date-time" },
          },
        },
        HealthStatus: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["ok", "degraded"] },
            database: { type: "string", enum: ["connected", "disconnected"] },
            timestamp: { type: "string", format: "date-time" },
          },
        },
      },
    },
  },
  apis: ["./app.js", "./routes/*.js"],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;