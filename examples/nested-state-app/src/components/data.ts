export const projects = [
  {
    id: "atlas",
    name: "Atlas",
    owner: "Platform",
    summary: "A nested layout demo with shared app chrome and dynamic project routing.",
  },
  {
    id: "lumen",
    name: "Lumen",
    owner: "Design Systems",
    summary: "A second project so dynamic params are visible in the UI.",
  },
];

export function getProject(id: string) {
  return projects.find((project) => project.id === id) ?? projects[0];
}
