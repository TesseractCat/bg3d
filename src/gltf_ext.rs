use gltf::{buffer::Data, mesh::BoundingBox, Document, Gltf};
use rapier3d::{math::Point, na::Quaternion, prelude::{ColliderBuilder, Isometry, Rotation, Translation, Vector}};
use std::vec::IntoIter;

fn merge_bounding_boxes(mut a: BoundingBox, b: BoundingBox) -> BoundingBox {
    a.min = [a.min[0].min(b.min[0]), a.min[1].min(b.min[1]), a.min[2].min(b.min[2])];
    a.max = [a.max[0].max(b.max[0]), a.max[1].max(b.max[1]), a.max[2].max(b.max[2])];
    a
}

pub trait GltfExt {
    fn colliders(&self, buffers: &[Data]) -> IntoIter<ColliderBuilder>;
}
impl GltfExt for Document {
    fn colliders(&self, buffers: &[Data]) -> IntoIter<ColliderBuilder> {
        let colliders: Vec<_> = self
            .nodes()
            .filter_map(|node| {
                let extras: serde_json::Value = serde_json::from_str(node.extras().as_ref()?.get()).ok()?;

                let collider = extras.get("collider")?.as_str()?;

                let bounding_boxes: Vec<_> = node.mesh()?.primitives().map(|p| p.bounding_box()).collect();
                let bounds = bounding_boxes.into_iter().fold(BoundingBox {
                    min: [f32::MAX,f32::MAX,f32::MAX], max: [f32::MIN,f32::MIN,f32::MIN]
                }, |acc, b| merge_bounding_boxes(acc, b));
                let transform = node.transform().decomposed();

                let min = Vector::new(bounds.min[0], bounds.min[1], bounds.min[2]);
                let max = Vector::new(bounds.max[0], bounds.max[1], bounds.max[2]);
                let scale = Vector::new(transform.2[0], transform.2[1], transform.2[2]);
                let half = ((max - min)/2.).component_mul(&scale);
                let center = ((max + min)/2.).component_mul(&scale);
                
                // First translate center (of bounds) -> then rotation -> then translate node
                // FIXME: This whole thing probably doesn't support nested transformations!
                let rotation = Rotation::from_quaternion(
                    Quaternion::new(transform.1[3], transform.1[0], transform.1[1], transform.1[2])
                );
                let translation = Translation::from(
                    Vector::new(transform.0[0], transform.0[1], transform.0[2])
                );
                let isometry = Isometry::from_parts(translation, rotation) * Isometry::from(center);

                let collider = match collider {
                    "cylinder" => {
                        ColliderBuilder::cylinder(half.y, half.x).position(isometry)
                    },
                    "box" => {
                        ColliderBuilder::cuboid(half.x, half.y, half.z).position(isometry)
                    },
                    "convex" => {
                        let primitive = node.mesh()?.primitives().next()?;
                        let reader = primitive.reader(|buffer: gltf::Buffer| Some(&buffers[buffer.index()]));
                        let points: Vec<Point<f32>> = reader.read_positions()?.map(|p| Point::new(p[0], p[1], p[2])).collect();
                        ColliderBuilder::convex_hull(points.as_slice())?.position(isometry)
                    },
                    _ => {
                        ColliderBuilder::ball(1.0)
                    }
                };

                Some(collider)
            }).collect();

        colliders.into_iter()
    }
}