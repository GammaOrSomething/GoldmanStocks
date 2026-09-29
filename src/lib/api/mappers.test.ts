/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import {
  crewsBySite,
  toArea,
  toClient,
  toPlant,
  toProject,
  toWorker,
} from "./mappers";

const stamp = "2026-09-01T00:00:00Z";

describe("crewsBySite", () => {
  test("groups crews by site and lists the lead first", () => {
    const crews = crewsBySite([
      { project_id: "s1", worker_id: "w2", is_lead: false },
      { project_id: "s1", worker_id: "w1", is_lead: true },
      { project_id: "s1", worker_id: "w3", is_lead: false },
      { project_id: "s2", worker_id: "w3", is_lead: false },
    ]);
    expect(crews.get("s1")).toEqual({
      workerIds: ["w1", "w2", "w3"],
      leadWorkerId: "w1",
    });
    expect(crews.get("s2")).toEqual({ workerIds: ["w3"], leadWorkerId: "" });
    expect(crews.get("s3")).toBeUndefined();
  });
});

describe("toArea", () => {
  test("a company with coordinates has an area, labelled with its city", () => {
    expect(toArea({ city: "Tallinn", lat: 59.437, lng: 24.7536 })).toEqual({
      city: "Tallinn",
      lat: 59.437,
      lng: 24.7536,
    });
  });

  test("no coordinates is no area, whatever the city says", () => {
    expect(toArea({ city: "Tallinn", lat: null, lng: null })).toBeNull();
    expect(toArea({ city: "", lat: null, lng: 24.7 })).toBeNull();
    expect(toArea(null)).toBeNull();
  });
});

const project = {
  id: "s1",
  company_id: "co",
  client_id: "c1",
  name: "Courtyard",
  city: "Tallinn",
  address: "Main 1",
  lat: 59.4,
  lng: 24.7,
  zones: ["North"],
  visits_per_month: 4,
  status: "healthy" as const,
  created_at: stamp,
  updated_at: stamp,
};

describe("toProject", () => {
  test("takes crew and money from their own tables", () => {
    expect(
      toProject(
        project,
        "Client",
        { workerIds: ["w1", "w2"], leadWorkerId: "w1" },
        { monthly_value: 1200, contract_until: "2027-03-31" },
      ),
    ).toMatchObject({
      workerIds: ["w1", "w2"],
      leadWorkerId: "w1",
      monthlyValue: 1200,
      contractUntil: "2027-03-31",
    });
  });

  test("a worker, who can't read terms, sees no money", () => {
    expect(toProject(project, "Client", undefined, undefined)).toMatchObject({
      workerIds: [],
      leadWorkerId: "",
      monthlyValue: 0,
      contractUntil: "",
    });
  });
});

describe("toClient", () => {
  test("combines the record, the calculated stats and the terms", () => {
    const client = toClient(
      {
        id: "c1",
        company_id: "co",
        name: "Harbour",
        city: "Tallinn",
        contact: "Ann",
        health: "watch",
        created_at: stamp,
        updated_at: stamp,
      },
      { sites: 2, plants: 7, hoursThisMonth: 3.5 },
      undefined,
    );
    expect(client).toMatchObject({
      sites: 2,
      plants: 7,
      hoursThisMonth: 3.5,
      monthlyValue: 0,
      health: "watch",
    });
  });
});

describe("toWorker", () => {
  const row = {
    id: "w1",
    company_id: "co",
    user_id: null,
    email: null,
    name: "Liis",
    job_title: "Gardener",
    app_role: "worker" as const,
    language: "ET" as const,
    color: "var(--chart-1)",
    invited_at: null,
    accepted_at: null,
    archived_at: null,
    created_at: stamp,
    updated_at: stamp,
  };

  test("the job title is the displayed role; no login yet", () => {
    expect(toWorker(row)).toEqual({
      id: "w1",
      name: "Liis",
      role: "Gardener",
      language: "ET",
      color: "var(--chart-1)",
      email: "",
      appRole: "worker",
      hasLogin: false,
    });
  });

  test("an invited worker has a login and an invite date", () => {
    expect(
      toWorker({
        ...row,
        user_id: "u1",
        email: "liis@example.com",
        invited_at: stamp,
      }),
    ).toMatchObject({
      email: "liis@example.com",
      hasLogin: true,
      invitedAt: stamp,
    });
    expect(
      toWorker({ ...row, user_id: "u1", invited_at: stamp }).joinedAt,
    ).toBeUndefined();
  });

  test("once they accept, they have joined", () => {
    expect(
      toWorker({
        ...row,
        user_id: "u1",
        invited_at: stamp,
        accepted_at: stamp,
      }),
    ).toMatchObject({ hasLogin: true, joinedAt: stamp });
  });
});

describe("toPlant", () => {
  test("keeps the readable code and maps the zone", () => {
    const plant = toPlant(
      {
        id: "p1",
        company_id: "co",
        code: "PL-0007",
        project_id: "s1",
        species: "Tilia cordata",
        common: "Linden",
        kind: "Tree",
        zone: "North",
        status: "healthy",
        last_care: "2026-09-12",
        next_care: null,
        next_task: null,
        x: 20,
        y: 30,
        lat: null,
        lng: null,
        photo_path: null,
        created_at: stamp,
        updated_at: stamp,
      },
      "Harbour",
    );
    expect(plant).toMatchObject({
      code: "PL-0007",
      site: "North",
      lastCareDate: "2026-09-12",
      nextCare: "",
    });
    expect(plant.lat).toBeUndefined();
  });
});
